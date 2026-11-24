'use strict';

const http = require('http');
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const Patient = require('../src/models/Patient');
const Doctor = require('../src/models/Doctor');
const Prescription = require('../src/models/Prescription');
const Medicine = require('../src/models/Medicine');
const MedicineBatch = require('../src/models/MedicineBatch');
const StockTransaction = require('../src/models/StockTransaction');
const AuditLog = require('../src/models/AuditLog');
const generateToken = require('../src/utils/generateToken');

const originals = {
  userFindById: User.findById,
  patientFind: Patient.find,
  doctorFind: Doctor.find,
  prescriptionFind: Prescription.find,
  prescriptionCountDocuments: Prescription.countDocuments,
  prescriptionFindById: Prescription.findById,
  medicineFind: Medicine.find,
  medicineCountDocuments: Medicine.countDocuments,
  medicineFindById: Medicine.findById,
  batchFind: MedicineBatch.find,
  batchFindById: MedicineBatch.findById,
  batchUpdateOne: MedicineBatch.updateOne,
  batchSave: MedicineBatch.prototype.save,
  stockTransactionSave: StockTransaction.prototype.save,
  auditSave: AuditLog.prototype.save,
  readyState: Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState'),
  client: Object.getOwnPropertyDescriptor(mongoose.connection, 'client'),
  transaction: Object.getOwnPropertyDescriptor(mongoose.connection, 'transaction')
};

const users = new Map();
const patients = new Map();
const doctors = new Map();
const prescriptions = new Map();
const medicines = new Map();
const batches = new Map();
const stockTransactions = new Map();
const auditLogs = [];
let failAuditSave = false;
let passed = 0;
let failed = 0;
let server;

const assertTest = (condition, description) => {
  if (condition) {
    passed++;
    console.log(`  PASS: ${description}`);
  } else {
    failed++;
    console.error(`  FAIL: ${description}`);
  }
};

const idOf = (value) => String(value);

const matchesValue = (actual, expected) => {
  if (expected instanceof RegExp) {
    return expected.test(String(actual || ''));
  }
  if (expected && typeof expected === 'object' && !(expected instanceof Date) &&
      !(expected instanceof mongoose.Types.ObjectId)) {
    if (expected.$in) {
      return expected.$in.some((candidate) => idOf(actual) === idOf(candidate));
    }
    if (expected.$gte !== undefined && actual < expected.$gte) {
      return false;
    }
    if (expected.$lte !== undefined && actual > expected.$lte) {
      return false;
    }
    return true;
  }
  if (actual instanceof Date || expected instanceof Date) {
    return new Date(actual).getTime() === new Date(expected).getTime();
  }
  return idOf(actual) === idOf(expected);
};

const matches = (record, filter = {}) => {
  if (filter.$and && !filter.$and.every((item) => matches(record, item))) {
    return false;
  }
  if (filter.$or && !filter.$or.some((item) => matches(record, item))) {
    return false;
  }
  return Object.entries(filter).every(([field, expression]) => {
    if (field === '$and' || field === '$or') {
      return true;
    }
    return matchesValue(record[field], expression);
  });
};

const fakeQuery = (records) => {
  let rows = records;
  let skip = 0;
  let limit = Number.MAX_SAFE_INTEGER;
  let sort = null;
  const query = {
    select() {
      return this;
    },
    sort(value) {
      sort = value;
      return this;
    },
    skip(value) {
      skip = value;
      return this;
    },
    limit(value) {
      limit = value;
      return this;
    },
    lean() {
      if (sort) {
        rows = rows.slice().sort((left, right) => {
          for (const [field, direction] of Object.entries(sort)) {
            const a = left[field] instanceof Date ? left[field].getTime() : left[field];
            const b = right[field] instanceof Date ? right[field].getTime() : right[field];
            if (a < b) {
              return -direction;
            }
            if (a > b) {
              return direction;
            }
          }
          return 0;
        });
      }
      return Promise.resolve(rows.slice(skip, skip + limit));
    }
  };
  return query;
};

const fakeSingleQuery = (getValue) => ({
  session() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve().then(getValue).then(resolve, reject);
  }
});

const copyPrescription = (record) => ({
  ...record,
  items: record.items.map((item) => ({ ...item })),
  save: async function () {
    prescriptions.set(idOf(this._id), this);
    return this;
  }
});

const snapshotMap = (
  map,
  copy = (record) => (record.toObject ? record.toObject() : { ...record })
) =>
  new Map(Array.from(map, ([key, value]) => [key, copy(value)]));

const restoreMap = (target, snapshot) => {
  target.clear();
  for (const [key, value] of snapshot) {
    target.set(key, value);
  }
};

const setTopology = (type) => {
  Object.defineProperty(mongoose.connection, 'readyState', {
    configurable: true,
    value: 1
  });
  Object.defineProperty(mongoose.connection, 'client', {
    configurable: true,
    value: { topology: { description: { type } } }
  });
  Object.defineProperty(mongoose.connection, 'transaction', {
    configurable: true,
    value: async (operation) => {
      const state = {
        prescriptions: snapshotMap(prescriptions, copyPrescription),
        batches: snapshotMap(batches),
        stockTransactions: snapshotMap(stockTransactions),
        auditLength: auditLogs.length
      };
      try {
        return await operation({ transaction: true });
      } catch (error) {
        restoreMap(prescriptions, state.prescriptions);
        restoreMap(batches, state.batches);
        restoreMap(stockTransactions, state.stockTransactions);
        auditLogs.splice(state.auditLength);
        throw error;
      }
    }
  });
};

const createUser = (role) => {
  const user = {
    _id: new mongoose.Types.ObjectId(),
    name: `${role} Test User`,
    email: `${role.toLowerCase()}.${new mongoose.Types.ObjectId()}@example.test`,
    role,
    permissions: [],
    status: 'ACTIVE'
  };
  users.set(idOf(user._id), user);
  return user;
};

const createPatient = () => {
  const patient = {
    _id: new mongoose.Types.ObjectId(),
    name: 'Pharmacy Queue Patient',
    patientNumber: 'PAT-QUEUE-01',
    address: 'Restricted patient address',
    dateOfBirth: new Date('1980-01-01'),
    status: 'ACTIVE'
  };
  patients.set(idOf(patient._id), patient);
  return patient;
};

const createDoctor = () => {
  const doctor = {
    _id: new mongoose.Types.ObjectId(),
    name: 'Prescribing Doctor',
    status: 'ACTIVE'
  };
  doctors.set(idOf(doctor._id), doctor);
  return doctor;
};

const createMedicine = (name = 'Test Medicine') => {
  const medicine = {
    _id: new mongoose.Types.ObjectId(),
    identifier: `MED-${new mongoose.Types.ObjectId().toString().slice(-8)}`,
    name,
    genericName: 'Test Generic',
    strength: '10 mg',
    form: 'Tablet',
    category: 'Test',
    manufacturer: 'Test Manufacturer',
    reorderLevel: 2,
    active: true
  };
  medicines.set(idOf(medicine._id), medicine);
  return medicine;
};

const createBatch = (medicine, availableQuantity, expiryDate, batchNumber) => {
  const batch = {
    _id: new mongoose.Types.ObjectId(),
    medicineId: medicine._id,
    batchNumber,
    expiryDate,
    receivedQuantity: availableQuantity,
    availableQuantity,
    receivedAt: new Date()
  };
  batches.set(idOf(batch._id), batch);
  return batch;
};

const createPrescription = (patient, doctor, medicineItems, status = 'PENDING') => {
  const prescription = {
    _id: new mongoose.Types.ObjectId(),
    patientId: patient._id,
    doctorId: doctor._id,
    medicalRecordId: new mongoose.Types.ObjectId(),
    items: medicineItems.map(({ medicine, quantity, dispensedQuantity = 0 }) => ({
      medicineId: medicine._id,
      dosage: '1 tablet',
      route: 'oral',
      frequency: 'twice daily',
      duration: '5 days',
      quantity,
      dispensedQuantity,
      instructions: 'Take after meals'
    })),
    issuedAt: new Date(),
    status,
    save: async function () {
      prescriptions.set(idOf(this._id), this);
      return this;
    }
  };
  prescriptions.set(idOf(prescription._id), prescription);
  return prescription;
};

const request = (method, path, { token, body } = {}) =>
  new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: server.address().port,
        path,
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
              }
            : {})
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          resolve({
            statusCode: res.statusCode,
            body: raw ? JSON.parse(raw) : null
          });
        });
      }
    );
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });

const setupMocks = () => {
  User.findById = async (id) => users.get(idOf(id)) || null;
  Patient.find = (filter) =>
    fakeQuery(Array.from(patients.values()).filter((item) => matches(item, filter)));
  Doctor.find = (filter) =>
    fakeQuery(Array.from(doctors.values()).filter((item) => matches(item, filter)));
  Prescription.find = (filter) =>
    fakeQuery(
      Array.from(prescriptions.values()).filter((item) => matches(item, filter))
    );
  Prescription.countDocuments = async (filter) =>
    Array.from(prescriptions.values()).filter((item) => matches(item, filter)).length;
  Prescription.findById = (id) =>
    fakeSingleQuery(() => prescriptions.get(idOf(id)) || null);
  Medicine.find = (filter) =>
    fakeQuery(Array.from(medicines.values()).filter((item) => matches(item, filter)));
  Medicine.countDocuments = async (filter) =>
    Array.from(medicines.values()).filter((item) => matches(item, filter)).length;
  Medicine.findById = (id) =>
    fakeSingleQuery(() => medicines.get(idOf(id)) || null);
  MedicineBatch.find = (filter) =>
    fakeQuery(Array.from(batches.values()).filter((item) => matches(item, filter)));
  MedicineBatch.findById = (id) =>
    fakeSingleQuery(() => batches.get(idOf(id)) || null);
  MedicineBatch.updateOne = async (filter, update) => {
    const batch = batches.get(idOf(filter._id));
    if (!batch || !matches(batch, filter)) {
      return { matchedCount: 0 };
    }
    batch.availableQuantity += update.$inc.availableQuantity;
    return { matchedCount: 1 };
  };
  MedicineBatch.prototype.save = async function () {
    const duplicate = Array.from(batches.values()).some(
      (item) =>
        idOf(item.medicineId) === idOf(this.medicineId) &&
        item.batchNumber === this.batchNumber
    );
    if (duplicate) {
      const error = new Error('Duplicate medicine batch.');
      error.code = 11000;
      throw error;
    }
    batches.set(idOf(this._id), this);
    return this;
  };
  StockTransaction.prototype.save = async function () {
    stockTransactions.set(idOf(this._id), this);
    return this;
  };
  AuditLog.prototype.save = async function () {
    if (failAuditSave) {
      throw new Error('Simulated audit persistence failure');
    }
    auditLogs.push(this);
    return this;
  };
};

const restoreMocks = async () => {
  User.findById = originals.userFindById;
  Patient.find = originals.patientFind;
  Doctor.find = originals.doctorFind;
  Prescription.find = originals.prescriptionFind;
  Prescription.countDocuments = originals.prescriptionCountDocuments;
  Prescription.findById = originals.prescriptionFindById;
  Medicine.find = originals.medicineFind;
  Medicine.countDocuments = originals.medicineCountDocuments;
  Medicine.findById = originals.medicineFindById;
  MedicineBatch.find = originals.batchFind;
  MedicineBatch.findById = originals.batchFindById;
  MedicineBatch.updateOne = originals.batchUpdateOne;
  MedicineBatch.prototype.save = originals.batchSave;
  StockTransaction.prototype.save = originals.stockTransactionSave;
  AuditLog.prototype.save = originals.auditSave;
  for (const [property, descriptor] of [
    ['readyState', originals.readyState],
    ['client', originals.client],
    ['transaction', originals.transaction]
  ]) {
    if (descriptor) {
      Object.defineProperty(mongoose.connection, property, descriptor);
    } else {
      delete mongoose.connection[property];
    }
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
};

const runTests = async () => {
  setupMocks();
  setTopology('ReplicaSetWithPrimary');
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  const pharmacy = createUser('PHARMACY');
  const patientUser = createUser('PATIENT');
  const doctorUser = createUser('DOCTOR');
  const pharmacyToken = generateToken(pharmacy);
  const patientToken = generateToken(patientUser);
  const doctorToken = generateToken(doctorUser);
  const patient = createPatient();
  const doctor = createDoctor();
  const medicine = createMedicine();
  const today = new Date();
  const validExpiry = new Date(Date.UTC(today.getUTCFullYear() + 1, 0, 1));
  const expiredDate = new Date(Date.UTC(today.getUTCFullYear() - 1, 0, 1));
  const validBatch = createBatch(medicine, 12, validExpiry, 'BATCH-VALID');
  const expiredBatch = createBatch(medicine, 7, expiredDate, 'BATCH-EXPIRED');
  const prescription = createPrescription(patient, doctor, [{ medicine, quantity: 5 }]);
  const noStockMedicine = createMedicine('No Stock Medicine');
  const noStockBatch = createBatch(noStockMedicine, 1, validExpiry, 'BATCH-LOW');
  const rollbackPrescription = createPrescription(patient, doctor, [
    { medicine, quantity: 2 },
    { medicine: noStockMedicine, quantity: 2 }
  ]);
  try {
    console.log('\n--- Pharmacy mocked API tests ---');
    const invalidBatchSchema = new MedicineBatch({
      medicineId: medicine._id,
      batchNumber: 'INVALID',
      expiryDate: validExpiry,
      receivedQuantity: 3,
      availableQuantity: 4
    });
    const invalidPrescriptionSchema = new Prescription({
      patientId: patient._id,
      doctorId: doctor._id,
      items: []
    });
    const invalidBatchError = await invalidBatchSchema.validate().then(
      () => null,
      (error) => error
    );
    const invalidPrescriptionError = await invalidPrescriptionSchema.validate().then(
      () => null,
      (error) => error
    );
    assertTest(
      Boolean(invalidBatchError && invalidBatchError.name === 'ValidationError') &&
        Boolean(
          invalidPrescriptionError &&
            invalidPrescriptionError.name === 'ValidationError'
        ),
      'Schemas reject batch quantities above receipt and prescriptions missing required consultation links'
    );

    const unauthenticatedQueue = await request('GET', '/api/prescriptions/pending');
    const patientQueue = await request('GET', '/api/prescriptions/pending', {
      token: patientToken
    });
    const doctorQueue = await request('GET', '/api/prescriptions/pending', {
      token: doctorToken
    });
    const pharmacyQueue = await request('GET', '/api/prescriptions/pending', {
      token: pharmacyToken
    });
    assertTest(
      unauthenticatedQueue.statusCode === 401 &&
        patientQueue.statusCode === 403 &&
        doctorQueue.statusCode === 403 &&
        pharmacyQueue.statusCode === 200,
      'Pending queue requires authentication and PHARMACY role'
    );
    const queuedPrescription = pharmacyQueue.body.data.prescriptions.find(
      (item) => idOf(item._id) === idOf(prescription._id)
    );
    assertTest(
      queuedPrescription &&
        queuedPrescription.patient.name === patient.name &&
        !Object.prototype.hasOwnProperty.call(queuedPrescription, 'medicalRecordId') &&
        !Object.prototype.hasOwnProperty.call(queuedPrescription.patient, 'address'),
      'Pharmacy queue returns dispensing details without clinical notes or restricted patient fields'
    );
    const searchedQueue = await request(
      'GET',
      '/api/prescriptions/pending?search=PAT-QUEUE-01',
      { token: pharmacyToken }
    );
    const invalidQueuePagination = await request(
      'GET',
      '/api/prescriptions/pending?page=0',
      { token: pharmacyToken }
    );
    assertTest(
      searchedQueue.statusCode === 200 &&
        searchedQueue.body.data.prescriptions.length === 2 &&
        invalidQueuePagination.statusCode === 400,
      'Queue patient search and pagination validation behave as documented'
    );

    const medicineList = await request('GET', '/api/medicines?search=Test', {
      token: pharmacyToken
    });
    const availability = await request(
      'GET',
      `/api/medicines/availability?medicineId=${medicine._id}`,
      { token: pharmacyToken }
    );
    assertTest(
      medicineList.statusCode === 200 &&
        medicineList.body.data.medicines.some(
          (item) =>
            idOf(item._id) === idOf(medicine._id) && item.usableQuantity === 12
        ) &&
        availability.statusCode === 200 &&
        availability.body.data.medicines[0].expiredQuantity === 7 &&
        availability.body.data.medicines[0].batches.some((item) => item.isExpired),
      'Catalogue search and availability distinguish usable from expired stock'
    );

    const forbiddenReceipt = await request('POST', '/api/stock/receipts', {
      token: doctorToken,
      body: {
        medicineId: medicine._id,
        batchNumber: 'DENIED',
        expiryDate: '2099-12-31',
        receivedQuantity: 4
      }
    });
    const forbiddenDispense = await request('POST', '/api/dispensing', {
      token: patientToken,
      body: { prescriptionId: prescription._id, items: [] }
    });
    const doctorDispense = await request('POST', '/api/dispensing', {
      token: doctorToken,
      body: { prescriptionId: prescription._id, items: [] }
    });
    assertTest(
      forbiddenReceipt.statusCode === 403 &&
        forbiddenDispense.statusCode === 403 &&
        doctorDispense.statusCode === 403,
      'PATIENT and DOCTOR cannot call pharmacy-only stock or dispensing operations'
    );

    const receiptPayload = {
      medicineId: medicine._id,
      batchNumber: 'BATCH-RECEIPT-01',
      expiryDate: '2099-12-31',
      receivedQuantity: 6,
      supplierReference: 'SUP-001'
    };
    const receipt = await request('POST', '/api/stock/receipts', {
      token: pharmacyToken,
      body: receiptPayload
    });
    const duplicateReceipt = await request('POST', '/api/stock/receipts', {
      token: pharmacyToken,
      body: receiptPayload
    });
    const expiredReceipt = await request('POST', '/api/stock/receipts', {
      token: pharmacyToken,
      body: { ...receiptPayload, batchNumber: 'BATCH-PAST', expiryDate: '2000-01-01' }
    });
    const invalidQuantityReceipt = await request('POST', '/api/stock/receipts', {
      token: pharmacyToken,
      body: { ...receiptPayload, batchNumber: 'BATCH-FRACTION', receivedQuantity: 1.5 }
    });
    assertTest(
      receipt.statusCode === 201 &&
        duplicateReceipt.statusCode === 409 &&
        expiredReceipt.statusCode === 400 &&
        invalidQuantityReceipt.statusCode === 400,
      'Valid receipts persist and duplicate, expired, and invalid quantity receipts are rejected'
    );
    assertTest(
      receipt.body.data.batch.availableQuantity === 6 &&
        Array.from(stockTransactions.values()).some(
          (item) =>
            item.transactionType === 'RECEIPT' &&
            idOf(item.actorId) === idOf(pharmacy._id)
        ) &&
        auditLogs.some(
          (item) =>
            item.action === 'STOCK_RECEIVED' &&
            item.resourceType === 'MedicineBatch' &&
            idOf(item.actorId) === idOf(pharmacy._id)
        ),
      'Stock receipt records batch quantity, transaction, and authenticated-actor audit'
    );

    const dispensing = await request('POST', '/api/dispensing', {
      token: pharmacyToken,
      body: {
        prescriptionId: prescription._id,
        items: [
          {
            medicineId: medicine._id,
            quantity: 5,
            batches: [{ batchId: validBatch._id, quantity: 5 }]
          }
        ]
      }
    });
    const duplicateDispensing = await request('POST', '/api/dispensing', {
      token: pharmacyToken,
      body: {
        prescriptionId: prescription._id,
        items: [
          {
            medicineId: medicine._id,
            quantity: 1,
            batches: [{ batchId: validBatch._id, quantity: 1 }]
          }
        ]
      }
    });
    assertTest(
      dispensing.statusCode === 200 &&
        dispensing.body.data.prescription.status === 'DISPENSED' &&
      batches.get(idOf(validBatch._id)).availableQuantity === 7 &&
        duplicateDispensing.statusCode === 409,
      'Successful dispensing decreases batch stock and completed prescriptions cannot be dispensed again'
    );
    assertTest(
      auditLogs.some(
        (item) =>
          item.action === 'PRESCRIPTION_DISPENSED' &&
          idOf(item.resourceId) === idOf(prescription._id) &&
          idOf(item.actorId) === idOf(pharmacy._id)
      ) &&
        Array.from(stockTransactions.values()).some(
          (item) =>
            item.transactionType === 'DISPENSING' &&
            idOf(item.prescriptionId) === idOf(prescription._id)
        ),
      'Dispensing records stock transactions and an audit entry for the authenticated actor'
    );

    const expiredPrescription = createPrescription(patient, doctor, [
      { medicine, quantity: 1 }
    ]);
    const expiredDispensing = await request('POST', '/api/dispensing', {
      token: pharmacyToken,
      body: {
        prescriptionId: expiredPrescription._id,
        items: [
          {
            medicineId: medicine._id,
            quantity: 1,
            batches: [{ batchId: expiredBatch._id, quantity: 1 }]
          }
        ]
      }
    });
    const overPrescribed = await request('POST', '/api/dispensing', {
      token: pharmacyToken,
      body: {
        prescriptionId: expiredPrescription._id,
        items: [
          {
            medicineId: medicine._id,
            quantity: 2,
            batches: [{ batchId: validBatch._id, quantity: 2 }]
          }
        ]
      }
    });
    const insufficientStock = await request('POST', '/api/dispensing', {
      token: pharmacyToken,
      body: {
        prescriptionId: rollbackPrescription._id,
        items: [
          {
            medicineId: noStockMedicine._id,
            quantity: 2,
            batches: [{ batchId: noStockBatch._id, quantity: 2 }]
          }
        ]
      }
    });
    assertTest(
      expiredDispensing.statusCode === 409 &&
        overPrescribed.statusCode === 409 &&
        insufficientStock.statusCode === 409,
      'Expired, over-prescribed, and insufficient-stock dispensing requests are rejected'
    );

    const rollbackFirstBatch = createBatch(
      medicine,
      4,
      validExpiry,
      'BATCH-ROLLBACK'
    );
    const beforeRollbackStock = rollbackFirstBatch.availableQuantity;
    const beforeRollbackTransactions = stockTransactions.size;
    const failedMultiLineDispense = await request('POST', '/api/dispensing', {
      token: pharmacyToken,
      body: {
        prescriptionId: rollbackPrescription._id,
        items: [
          {
            medicineId: medicine._id,
            quantity: 1,
            batches: [{ batchId: rollbackFirstBatch._id, quantity: 1 }]
          },
          {
            medicineId: noStockMedicine._id,
            quantity: 2,
            batches: [{ batchId: noStockBatch._id, quantity: 2 }]
          }
        ]
      }
    });
    assertTest(
      failedMultiLineDispense.statusCode === 409 &&
        batches.get(idOf(rollbackFirstBatch._id)).availableQuantity === beforeRollbackStock &&
        stockTransactions.size === beforeRollbackTransactions &&
        prescriptions.get(idOf(rollbackPrescription._id)).status === 'PENDING',
      'Failed multi-line dispensing rolls back earlier stock changes and transaction records'
    );

    const noPrescriptionCreation = await request('POST', '/api/prescriptions', {
      token: doctorToken,
      body: {}
    });
    assertTest(
      [400, 404].includes(noPrescriptionCreation.statusCode),
      'Prescription creation validates required consultation linkage when empty payload is submitted'
    );

    const auditCountBeforeFailure = auditLogs.length;
    failAuditSave = true;
    const auditFailureReceipt = await request('POST', '/api/stock/receipts', {
      token: pharmacyToken,
      body: { ...receiptPayload, batchNumber: 'BATCH-AUDIT-FAILURE' }
    });
    failAuditSave = false;
    assertTest(
      auditFailureReceipt.statusCode === 500 &&
        !Array.from(batches.values()).some(
          (item) => item.batchNumber === 'BATCH-AUDIT-FAILURE'
        ) &&
        stockTransactions.size === beforeRollbackTransactions &&
        auditLogs.length === auditCountBeforeFailure,
      'Audit persistence failure aborts and rolls back a stock receipt'
    );

    setTopology('Single');
    const unsupportedTransactionReceipt = await request('POST', '/api/stock/receipts', {
      token: pharmacyToken,
      body: { ...receiptPayload, batchNumber: 'BATCH-NO-TRANSACTIONS' }
    });
    assertTest(
      unsupportedTransactionReceipt.statusCode === 503 &&
        !Array.from(batches.values()).some(
          (item) => item.batchNumber === 'BATCH-NO-TRANSACTIONS'
        ),
      'Standalone MongoDB topology fails closed for inventory mutations'
    );
  } finally {
    failAuditSave = false;
    await restoreMocks();
  }

  console.log(
    `\nPharmacy mocked API assertions: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`
  );
  if (failed > 0) {
    process.exitCode = 1;
  }
};

runTests().catch(async (error) => {
  console.error(error);
  await restoreMocks();
  process.exitCode = 1;
});
