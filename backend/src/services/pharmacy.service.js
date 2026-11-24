'use strict';

const mongoose = require('mongoose');
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');
const Prescription = require('../models/Prescription');
const Medicine = require('../models/Medicine');
const MedicineBatch = require('../models/MedicineBatch');
const StockTransaction = require('../models/StockTransaction');
const { recordAudit } = require('./audit.service');

const TRANSACTION_TOPOLOGIES = new Set([
  'ReplicaSetWithPrimary',
  'ReplicaSetNoPrimary',
  'Sharded'
]);
const PRESCRIPTION_STATUSES = ['PENDING', 'PARTIALLY_DISPENSED'];
const MEDICINE_FIELDS =
  '_id identifier name genericName strength form category manufacturer reorderLevel active';
const BATCH_FIELDS =
  '_id medicineId batchNumber expiryDate receivedQuantity availableQuantity';

const createError = (statusCode, message, errors = []) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errors = errors;
  return error;
};

const isObjectId = (value) =>
  typeof value === 'string' &&
  mongoose.Types.ObjectId.isValid(value) &&
  String(new mongoose.Types.ObjectId(value)) === value;

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const assertKnownFields = (payload, allowedFields) => {
  const unknown = Object.keys(payload).filter((field) => !allowedFields.includes(field));
  if (unknown.length > 0) {
    throw createError(400, `Unrecognised fields: ${unknown.join(', ')}.`, unknown);
  }
};

const parsePositiveInteger = (value, field, defaultValue) => {
  if (value === undefined) {
    return defaultValue;
  }
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  ) {
    throw createError(400, `${field} must be a positive whole number.`, [field]);
  }
  return Number(value);
};

const parsePagination = (query = {}) => {
  const page = parsePositiveInteger(query.page, 'page', 1);
  const requestedLimit = parsePositiveInteger(query.limit, 'limit', 20);
  if (requestedLimit > 100) {
    throw createError(400, 'limit cannot exceed 100.', ['limit']);
  }
  const skip = (page - 1) * requestedLimit;
  if (!Number.isSafeInteger(skip)) {
    throw createError(400, 'page is too large.', ['page']);
  }
  return { page, limit: requestedLimit, skip };
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const readSearchTerm = (search) => {
  if (search === undefined) {
    return '';
  }
  if (typeof search !== 'string' || search.trim().length > 100) {
    throw createError(400, 'search must be a string of at most 100 characters.', [
      'search'
    ]);
  }
  return search.trim();
};

const readSearchFilter = (search) => {
  const normalized = readSearchTerm(search);
  if (!normalized) {
    return {};
  }
  const expression = new RegExp(escapeRegex(normalized), 'i');
  return {
    $or: [
      { identifier: expression },
      { name: expression },
      { genericName: expression }
    ]
  };
};

const readRequiredText = (value, field, maxLength) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw createError(400, `${field} is required.`, [field]);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw createError(400, `${field} cannot exceed ${maxLength} characters.`, [field]);
  }
  return normalized;
};

const readOptionalText = (value, field, maxLength) => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw createError(400, `${field} must be a string.`, [field]);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw createError(400, `${field} cannot exceed ${maxLength} characters.`, [field]);
  }
  return normalized || undefined;
};

const readQuantity = (value, field) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw createError(400, `${field} must be a positive whole number.`, [field]);
  }
  return value;
};

const parseDateOnly = (value, field) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError(400, `${field} must use YYYY-MM-DD format.`, [field]);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw createError(400, `${field} must be a valid calendar date.`, [field]);
  }
  return date;
};

const utcDayStart = (date = new Date()) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const supportsTransactions = () => {
  const connection = mongoose.connection;
  const topology = connection.client && connection.client.topology;
  const topologyType = topology && topology.description && topology.description.type;
  return connection.readyState === 1 &&
    typeof connection.transaction === 'function' &&
    TRANSACTION_TOPOLOGIES.has(topologyType);
};

const withRequiredTransaction = async (operation) => {
  if (!supportsTransactions()) {
    throw createError(
      503,
      'Inventory mutations require MongoDB replica-set or sharded transactions; no changes were made.'
    );
  }
  return mongoose.connection.transaction(operation);
};

const withSession = (query, session) =>
  session && query && typeof query.session === 'function'
    ? query.session(session)
    : query;

const recordPharmacyAudit = async (event, session) => {
  try {
    await recordAudit(event, session);
  } catch (cause) {
    const error = createError(
      500,
      'Audit logging failed; the inventory transaction was not committed.'
    );
    error.cause = cause;
    throw error;
  }
};

const findLean = async (model, filter, { projection, sort, skip, limit } = {}) => {
  let query = model.find(filter);
  if (projection && typeof query.select === 'function') {
    query = query.select(projection);
  }
  if (sort && typeof query.sort === 'function') {
    query = query.sort(sort);
  }
  if (skip !== undefined && typeof query.skip === 'function') {
    query = query.skip(skip);
  }
  if (limit !== undefined && typeof query.limit === 'function') {
    query = query.limit(limit);
  }
  if (typeof query.lean === 'function') {
    query = query.lean();
  }
  return query;
};

const normalizeDatabaseError = (error, duplicateMessage) => {
  if (error && error.statusCode) {
    return error;
  }
  if (error && error.code === 11000) {
    return createError(409, duplicateMessage);
  }
  if (error instanceof mongoose.Error.ValidationError) {
    return createError(400, 'Pharmacy operation details are invalid.');
  }
  const safeError = createError(500, 'Pharmacy operation could not be completed.');
  safeError.cause = error;
  return safeError;
};

const normalizeAndThrow = (error, duplicateMessage) => {
  throw normalizeDatabaseError(error, duplicateMessage);
};

const getMedicinePage = async (query = {}) => {
  if (!isPlainObject(query)) {
    throw createError(400, 'Query parameters are invalid.');
  }
  assertKnownFields(query, ['page', 'limit', 'search']);
  const { page, limit, skip } = parsePagination(query);
  const filter = { active: true, ...readSearchFilter(query.search) };
  const [medicines, total] = await Promise.all([
    findLean(Medicine, filter, {
      projection: MEDICINE_FIELDS,
      sort: { name: 1, _id: 1 },
      skip,
      limit
    }),
    Medicine.countDocuments(filter)
  ]);
  const batches = medicines.length
    ? await findLean(
        MedicineBatch,
        { medicineId: { $in: medicines.map((medicine) => medicine._id) } },
        { projection: BATCH_FIELDS }
      )
    : [];
  const availability = summarizeAvailability(batches, new Date());
  return {
    medicines: medicines.map((medicine) => {
      const summary = availability.get(String(medicine._id));
      return {
        ...medicine,
        usableQuantity: summary ? summary.usableQuantity : 0
      };
    }),
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
};

const summarizeAvailability = (batches, now) => {
  const dayStart = utcDayStart(now);
  const byMedicine = new Map();
  for (const batch of batches) {
    const key = String(batch.medicineId);
    if (!byMedicine.has(key)) {
      byMedicine.set(key, { usableQuantity: 0, expiredQuantity: 0, batches: [] });
    }
    const summary = byMedicine.get(key);
    const isExpired = new Date(batch.expiryDate) < dayStart;
    if (isExpired) {
      summary.expiredQuantity += batch.availableQuantity;
    } else {
      summary.usableQuantity += batch.availableQuantity;
    }
    if (batch.availableQuantity > 0) {
      summary.batches.push({
        _id: batch._id,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        availableQuantity: batch.availableQuantity,
        isExpired
      });
    }
  }
  return byMedicine;
};

const getMedicineAvailability = async (query = {}) => {
  if (!isPlainObject(query)) {
    throw createError(400, 'Query parameters are invalid.');
  }
  assertKnownFields(query, ['page', 'limit', 'search', 'medicineId']);
  const { page, limit, skip } = parsePagination(query);
  const filter = { active: true, ...readSearchFilter(query.search) };
  if (query.medicineId !== undefined) {
    if (!isObjectId(query.medicineId)) {
      throw createError(400, 'medicineId must be a valid medicine identifier.', [
        'medicineId'
      ]);
    }
    filter._id = query.medicineId;
  }
  const [medicines, total] = await Promise.all([
    findLean(Medicine, filter, {
      projection: MEDICINE_FIELDS,
      sort: { name: 1, _id: 1 },
      skip,
      limit
    }),
    Medicine.countDocuments(filter)
  ]);
  const batches = medicines.length
    ? await findLean(
        MedicineBatch,
        { medicineId: { $in: medicines.map((medicine) => medicine._id) } },
        { projection: BATCH_FIELDS, sort: { expiryDate: 1, _id: 1 } }
      )
    : [];
  const availability = summarizeAvailability(batches, new Date());
  return {
    medicines: medicines.map((medicine) => {
      const summary = availability.get(String(medicine._id)) || {
        usableQuantity: 0,
        expiredQuantity: 0,
        batches: []
      };
      return {
        ...medicine,
        usableQuantity: summary.usableQuantity,
        expiredQuantity: summary.expiredQuantity,
        batches: summary.batches
      };
    }),
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
};

const getPendingPrescriptions = async (query = {}) => {
  if (!isPlainObject(query)) {
    throw createError(400, 'Query parameters are invalid.');
  }
  assertKnownFields(query, ['page', 'limit', 'search']);
  const { page, limit, skip } = parsePagination(query);
  const filter = { status: { $in: PRESCRIPTION_STATUSES } };
  const search = readSearchTerm(query.search);
  if (search) {
    const expression = new RegExp(escapeRegex(search), 'i');
    const matchingPatients = await findLean(
      Patient,
      { $or: [{ name: expression }, { patientNumber: expression }] },
      { projection: '_id' }
    );
    filter.patientId = { $in: matchingPatients.map((patient) => patient._id) };
  }
  const [prescriptions, total] = await Promise.all([
    findLean(Prescription, filter, {
      sort: { issuedAt: 1, _id: 1 },
      skip,
      limit
    }),
    Prescription.countDocuments(filter)
  ]);

  const patientIds = [...new Set(prescriptions.map((item) => String(item.patientId)))];
  const doctorIds = [...new Set(prescriptions.map((item) => String(item.doctorId)))];
  const medicineIds = [
    ...new Set(
      prescriptions.flatMap((prescription) =>
        prescription.items.map((item) => String(item.medicineId))
      )
    )
  ];
  const [patients, doctors, medicines] = await Promise.all([
    patientIds.length
      ? findLean(
          Patient,
          { _id: { $in: patientIds } },
          { projection: '_id name patientNumber' }
        )
      : [],
    doctorIds.length
      ? findLean(Doctor, { _id: { $in: doctorIds } }, { projection: '_id name' })
      : [],
    medicineIds.length
      ? findLean(
          Medicine,
          { _id: { $in: medicineIds } },
          { projection: '_id identifier name strength form' }
        )
      : []
  ]);
  const patientById = new Map(patients.map((patient) => [String(patient._id), patient]));
  const doctorById = new Map(doctors.map((doctor) => [String(doctor._id), doctor]));
  const medicineById = new Map(
    medicines.map((medicine) => [String(medicine._id), medicine])
  );

  return {
    prescriptions: prescriptions.map((prescription) => {
      const patient = patientById.get(String(prescription.patientId));
      const doctor = doctorById.get(String(prescription.doctorId));
      return {
        _id: prescription._id,
        issuedAt: prescription.issuedAt,
        status: prescription.status,
        patient: patient
          ? {
              _id: patient._id,
              name: patient.name,
              patientNumber: patient.patientNumber
            }
          : null,
        doctor: doctor ? { _id: doctor._id, name: doctor.name } : null,
        items: prescription.items.map((item) => {
          const medicine = medicineById.get(String(item.medicineId));
          return {
            medicine: medicine
              ? {
                  _id: medicine._id,
                  identifier: medicine.identifier,
                  name: medicine.name,
                  strength: medicine.strength,
                  form: medicine.form
                }
              : null,
            dosage: item.dosage,
            route: item.route,
            frequency: item.frequency,
            duration: item.duration,
            quantity: item.quantity,
            dispensedQuantity: item.dispensedQuantity || 0,
            instructions: item.instructions
          };
        })
      };
    }),
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
};

const validateReceiptPayload = (payload) => {
  if (!isPlainObject(payload)) {
    throw createError(400, 'Request body must be an object.');
  }
  assertKnownFields(payload, [
    'medicineId',
    'batchNumber',
    'expiryDate',
    'receivedQuantity',
    'supplierReference'
  ]);
  if (!isObjectId(payload.medicineId)) {
    throw createError(400, 'A valid medicineId is required.', ['medicineId']);
  }
  const batchNumber = readRequiredText(payload.batchNumber, 'batchNumber', 100)
    .toUpperCase();
  const expiryDate = parseDateOnly(payload.expiryDate, 'expiryDate');
  if (expiryDate < utcDayStart()) {
    throw createError(400, 'Expired batches cannot be received.', ['expiryDate']);
  }
  const receivedQuantity = readQuantity(payload.receivedQuantity, 'receivedQuantity');
  const supplierReference = readOptionalText(
    payload.supplierReference,
    'supplierReference',
    100
  );
  return {
    medicineId: payload.medicineId,
    batchNumber,
    expiryDate,
    receivedQuantity,
    supplierReference
  };
};

const recordStockReceipt = async (payload, actor) => {
  const receipt = validateReceiptPayload(payload);
  if (!actor || !isObjectId(String(actor._id))) {
    throw createError(401, 'Authenticated user identity is invalid.');
  }

  try {
    return await withRequiredTransaction(async (session) => {
      const medicine = await withSession(
        Medicine.findById(receipt.medicineId),
        session
      );
      if (!medicine || !medicine.active) {
        throw createError(404, 'Active medicine was not found.');
      }

      const batch = new MedicineBatch({
        ...receipt,
        availableQuantity: receipt.receivedQuantity
      });
      await batch.save({ session });

      const transaction = new StockTransaction({
        medicineId: medicine._id,
        batchId: batch._id,
        transactionType: 'RECEIPT',
        quantity: receipt.receivedQuantity,
        actorId: actor._id,
        reason: 'Stock receipt'
      });
      await transaction.save({ session });
      await recordPharmacyAudit(
        {
          actorId: actor._id,
          action: 'STOCK_RECEIVED',
          resourceType: 'MedicineBatch',
          resourceId: batch._id,
          accessType: 'PHARMACY'
        },
        session
      );

      return {
        batch: {
          _id: batch._id,
          medicineId: batch.medicineId,
          batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          receivedQuantity: batch.receivedQuantity,
          availableQuantity: batch.availableQuantity,
          receivedAt: batch.receivedAt,
          supplierReference: batch.supplierReference
        },
        transaction: {
          _id: transaction._id,
          transactionType: transaction.transactionType,
          quantity: transaction.quantity,
          actorId: transaction.actorId,
          timestamp: transaction.timestamp
        }
      };
    });
  } catch (error) {
    normalizeAndThrow(error, 'A batch with this medicine and batch number already exists.');
  }
};

const validateDispensingPayload = (payload) => {
  if (!isPlainObject(payload)) {
    throw createError(400, 'Request body must be an object.');
  }
  assertKnownFields(payload, ['prescriptionId', 'items']);
  if (!isObjectId(payload.prescriptionId)) {
    throw createError(400, 'A valid prescriptionId is required.', ['prescriptionId']);
  }
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw createError(400, 'At least one dispensing item is required.', ['items']);
  }

  const medicineIds = new Set();
  const items = payload.items.map((item, index) => {
    const prefix = `items[${index}]`;
    if (!isPlainObject(item)) {
      throw createError(400, `${prefix} must be an object.`, [prefix]);
    }
    assertKnownFields(item, ['medicineId', 'quantity', 'batches']);
    if (!isObjectId(item.medicineId)) {
      throw createError(400, `${prefix}.medicineId must be valid.`, [
        `${prefix}.medicineId`
      ]);
    }
    if (medicineIds.has(item.medicineId)) {
      throw createError(400, 'Each medicine may appear only once in items.', [
        `${prefix}.medicineId`
      ]);
    }
    medicineIds.add(item.medicineId);
    const quantity = readQuantity(item.quantity, `${prefix}.quantity`);
    if (!Array.isArray(item.batches) || item.batches.length === 0) {
      throw createError(400, `${prefix}.batches must contain at least one batch.`, [
        `${prefix}.batches`
      ]);
    }
    const batchIds = new Set();
    const batches = item.batches.map((allocation, batchIndex) => {
      const batchField = `${prefix}.batches[${batchIndex}]`;
      if (!isPlainObject(allocation)) {
        throw createError(400, `${batchField} must be an object.`, [batchField]);
      }
      assertKnownFields(allocation, ['batchId', 'quantity']);
      if (!isObjectId(allocation.batchId)) {
        throw createError(400, `${batchField}.batchId must be valid.`, [
          `${batchField}.batchId`
        ]);
      }
      if (batchIds.has(allocation.batchId)) {
        throw createError(400, 'A batch may appear only once per medicine.', [
          `${batchField}.batchId`
        ]);
      }
      batchIds.add(allocation.batchId);
      return {
        batchId: allocation.batchId,
        quantity: readQuantity(allocation.quantity, `${batchField}.quantity`)
      };
    });
    if (batches.reduce((total, batch) => total + batch.quantity, 0) !== quantity) {
      throw createError(400, `${prefix} batch quantities must equal quantity.`, [
        `${prefix}.batches`
      ]);
    }
    return { medicineId: item.medicineId, quantity, batches };
  });
  return { prescriptionId: payload.prescriptionId, items };
};

const recordDispensing = async (payload, actor) => {
  const dispensing = validateDispensingPayload(payload);
  if (!actor || !isObjectId(String(actor._id))) {
    throw createError(401, 'Authenticated user identity is invalid.');
  }

  try {
    return await withRequiredTransaction(async (session) => {
      const prescription = await withSession(
        Prescription.findById(dispensing.prescriptionId),
        session
      );
      if (!prescription) {
        throw createError(404, 'Prescription was not found.');
      }
      if (!PRESCRIPTION_STATUSES.includes(prescription.status)) {
        throw createError(409, 'Prescription is not available for dispensing.');
      }

      const transactionRecords = [];
      const today = utcDayStart();
      for (const item of dispensing.items) {
        const prescriptionItem = prescription.items.find(
          (existing) => String(existing.medicineId) === item.medicineId
        );
        if (!prescriptionItem) {
          throw createError(400, 'Medicine is not part of this prescription.', [
            'items'
          ]);
        }
        const remainingQuantity =
          prescriptionItem.quantity - (prescriptionItem.dispensedQuantity || 0);
        if (item.quantity > remainingQuantity) {
          throw createError(
            409,
            'Dispensed quantity cannot exceed the remaining prescribed quantity.'
          );
        }

        const medicine = await withSession(
          Medicine.findById(item.medicineId),
          session
        );
        if (!medicine || !medicine.active) {
          throw createError(409, 'Prescribed medicine is no longer active.');
        }

        for (const allocation of item.batches) {
          const batch = await withSession(
            MedicineBatch.findById(allocation.batchId),
            session
          );
          if (!batch || String(batch.medicineId) !== item.medicineId) {
            throw createError(404, 'Medicine batch was not found for this medicine.');
          }
          if (batch.expiryDate < today) {
            throw createError(409, 'Expired medicine batches cannot be dispensed.');
          }
          if (batch.availableQuantity < allocation.quantity) {
            throw createError(409, 'Insufficient medicine batch stock.');
          }

          const update = await MedicineBatch.updateOne(
            {
              _id: batch._id,
              medicineId: item.medicineId,
              expiryDate: { $gte: today },
              availableQuantity: { $gte: allocation.quantity }
            },
            { $inc: { availableQuantity: -allocation.quantity } },
            { session }
          );
          if (!update || update.matchedCount !== 1) {
            throw createError(
              409,
              'Medicine batch stock changed or expired; dispensing was not completed.'
            );
          }

          const transaction = new StockTransaction({
            medicineId: item.medicineId,
            batchId: batch._id,
            prescriptionId: prescription._id,
            transactionType: 'DISPENSING',
            quantity: allocation.quantity,
            actorId: actor._id,
            reason: 'Prescription dispensing'
          });
          await transaction.save({ session });
          transactionRecords.push(transaction);
        }
        prescriptionItem.dispensedQuantity =
          (prescriptionItem.dispensedQuantity || 0) + item.quantity;
      }

      const isComplete = prescription.items.every(
        (item) => (item.dispensedQuantity || 0) >= item.quantity
      );
      prescription.status = isComplete ? 'DISPENSED' : 'PARTIALLY_DISPENSED';
      await prescription.save({ session });
      await recordPharmacyAudit(
        {
          actorId: actor._id,
          action: 'PRESCRIPTION_DISPENSED',
          resourceType: 'Prescription',
          resourceId: prescription._id,
          accessType: 'PHARMACY'
        },
        session
      );

      return {
        prescription: {
          _id: prescription._id,
          status: prescription.status,
          items: prescription.items.map((item) => ({
            medicineId: item.medicineId,
            quantity: item.quantity,
            dispensedQuantity: item.dispensedQuantity
          }))
        },
        transactions: transactionRecords.map((transaction) => ({
          _id: transaction._id,
          medicineId: transaction.medicineId,
          batchId: transaction.batchId,
          quantity: transaction.quantity,
          transactionType: transaction.transactionType,
          timestamp: transaction.timestamp
        }))
      };
    });
  } catch (error) {
    normalizeAndThrow(error, 'Dispensing operation conflicts with existing data.');
  }
};

module.exports = {
  getMedicines: getMedicinePage,
  getMedicineAvailability,
  getPendingPrescriptions,
  recordStockReceipt,
  recordDispensing
};
