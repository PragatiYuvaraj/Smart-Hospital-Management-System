'use strict';

const mongoose = require('mongoose');
const DoctorAssignment = require('../models/DoctorAssignment');
const Doctor = require('../models/Doctor');
const Patient = require('../models/Patient');
const User = require('../models/User');
const { recordAudit } = require('./audit.service');

const createError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const isObjectId = (value) => {
  if (typeof value !== 'string' && !(value instanceof mongoose.Types.ObjectId)) {
    return false;
  }
  const asString = String(value);
  return mongoose.Types.ObjectId.isValid(asString) &&
    String(new mongoose.Types.ObjectId(asString)) === asString;
};

const canManageAssignments = (user) =>
  Boolean(user && (user.permissions || []).includes('MANAGE_USERS'));

const assertManager = (user) => {
  if (!canManageAssignments(user)) {
    throw createError(403, 'You are not authorized to manage assignments.');
  }
};

const parseStartDate = (value) => {
  if (value === undefined) {
    return new Date();
  }
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)
  ) {
    throw createError(400, 'A valid startDate is required.');
  }

  const startDate = new Date(value);
  const dateOnly = value.slice(0, 10);
  const calendarDate = new Date(`${dateOnly}T00:00:00.000Z`);
  if (
    Number.isNaN(startDate.getTime()) ||
    calendarDate.toISOString().slice(0, 10) !== dateOnly
  ) {
    throw createError(400, 'A valid startDate is required.');
  }
  return startDate;
};

const withSession = (query, session) => {
  if (session && query && typeof query.session === 'function') {
    return query.session(session);
  }
  return query;
};

const supportsTransactions = () => {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.client) {
    return false;
  }

  const topology = mongoose.connection.client.topology;
  const topologyType = topology && topology.description && topology.description.type;
  return ['ReplicaSetWithPrimary', 'ReplicaSetNoPrimary', 'Sharded'].includes(topologyType);
};

const normalizeDatabaseError = (error, duplicateMessage) => {
  if (error.statusCode) {
    return error;
  }
  if (error.code === 11000) {
    return createError(409, duplicateMessage);
  }
  if (error instanceof mongoose.Error.ValidationError) {
    return createError(400, 'Assignment details are invalid.');
  }

  const safeError = createError(500, 'Assignment operation could not be completed.');
  safeError.cause = error;
  return safeError;
};

const resolveActiveProfiles = async (patientId, doctorId, session) => {
  const [patient, doctor] = await Promise.all([
    withSession(Patient.findById(patientId), session),
    withSession(Doctor.findById(doctorId), session)
  ]);
  if (!patient) {
    throw createError(404, 'Patient profile not found.');
  }
  if (!doctor) {
    throw createError(404, 'Doctor profile not found.');
  }
  if (patient.status !== 'ACTIVE') {
    throw createError(409, 'Inactive patient profiles cannot be assigned.');
  }
  if (doctor.status !== 'ACTIVE') {
    throw createError(409, 'Inactive doctors cannot be assigned.');
  }

  const [patientUser, doctorUser] = await Promise.all([
    withSession(User.findById(patient.userId), session),
    withSession(User.findById(doctor.userId), session)
  ]);
  if (!patientUser || patientUser.role !== 'PATIENT') {
    throw createError(409, 'Patient profile is not linked to a valid patient account.');
  }
  if (!doctorUser || doctorUser.role !== 'DOCTOR') {
    throw createError(409, 'Doctor profile is not linked to a valid doctor account.');
  }
  if (patientUser.status !== 'ACTIVE' || doctorUser.status !== 'ACTIVE') {
    throw createError(409, 'Both linked user accounts must be active.');
  }

  return { patient, doctor };
};

const safeAssignment = (assignment) => ({
  _id: assignment._id,
  patientId: assignment.patientId,
  doctorId: assignment.doctorId,
  assignmentType: assignment.assignmentType,
  startDate: assignment.startDate,
  endDate: assignment.endDate,
  status: assignment.status,
  assignedBy: assignment.assignedBy,
  createdAt: assignment.createdAt,
  updatedAt: assignment.updatedAt
});

const newTreatingAssignment = (patientId, doctorId, assignedBy, startDate) =>
  new DoctorAssignment({
    patientId,
    doctorId,
    assignmentType: 'TREATING',
    startDate,
    endDate: null,
    status: 'ACTIVE',
    assignedBy
  });

const createAssignment = async (payload = {}, requestingUser) => {
  assertManager(requestingUser);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createError(400, 'Request body must be an object.');
  }

  const { patientId, doctorId } = payload;
  if (!isObjectId(patientId)) {
    throw createError(400, 'A valid patientId is required.');
  }
  if (!isObjectId(doctorId)) {
    throw createError(400, 'A valid doctorId is required.');
  }
  if (!isObjectId(requestingUser._id)) {
    throw createError(401, 'Authenticated user identity is invalid.');
  }
  const startDate = parseStartDate(payload.startDate);

  try {
    let assignment;
    if (supportsTransactions()) {
      await mongoose.connection.transaction(async (session) => {
        await resolveActiveProfiles(patientId, doctorId, session);
        const existing = await withSession(
          DoctorAssignment.findOne({
            patientId,
            assignmentType: 'TREATING',
            status: 'ACTIVE'
          }),
          session
        );
        if (existing) {
          throw createError(409, 'Patient already has an active treating-doctor assignment.');
        }

        assignment = newTreatingAssignment(
          patientId,
          doctorId,
          requestingUser._id,
          startDate
        );
        await assignment.save({ session });
      });
    } else {
      await resolveActiveProfiles(patientId, doctorId);
      const existing = await DoctorAssignment.findOne({
        patientId,
        assignmentType: 'TREATING',
        status: 'ACTIVE'
      });
      if (existing) {
        throw createError(409, 'Patient already has an active treating-doctor assignment.');
      }

      assignment = newTreatingAssignment(
        patientId,
        doctorId,
        requestingUser._id,
        startDate
      );
      await assignment.save();
    }

    await recordAudit({
      actorId: requestingUser._id,
      action: 'DOCTOR_PATIENT_ASSIGNED',
      resourceType: 'DoctorAssignment',
      resourceId: assignment._id,
      accessType: 'MANAGEMENT'
    });
    return safeAssignment(assignment);
  } catch (error) {
    throw normalizeDatabaseError(
      error,
      'Patient already has an active treating-doctor assignment.'
    );
  }
};

const getPatientAssignment = async (patientId, requestingUser) => {
  if (!isObjectId(patientId)) {
    throw createError(400, 'A valid patientId is required.');
  }

  const isManager = canManageAssignments(requestingUser);
  if (isManager) {
    const patient = await Patient.findById(patientId);
    if (!patient) {
      throw createError(404, 'Patient profile not found.');
    }
  } else if (requestingUser.role === 'PATIENT') {
    const ownPatient = await Patient.findOne({ userId: requestingUser._id });
    if (!ownPatient) {
      throw createError(404, 'Patient profile not found.');
    }
    if (String(ownPatient._id) !== String(patientId)) {
      throw createError(403, 'You may only view your own assignment.');
    }
  } else if (requestingUser.role === 'DOCTOR') {
    const doctor = await Doctor.findOne({ userId: requestingUser._id });
    if (!doctor || doctor.status !== 'ACTIVE') {
      throw createError(403, 'You are not authorized to view this assignment.');
    }
    const assigned = await DoctorAssignment.findOne({
      patientId,
      doctorId: doctor._id,
      assignmentType: 'TREATING',
      status: 'ACTIVE'
    });
    if (!assigned) {
      throw createError(403, 'You are not authorized to view this assignment.');
    }
    return { assignment: safeAssignment(assigned) };
  } else {
    throw createError(403, 'You are not authorized to view assignments.');
  }

  const assignment = await DoctorAssignment.findOne({
    patientId,
    assignmentType: 'TREATING',
    status: 'ACTIVE'
  });
  return { assignment: assignment ? safeAssignment(assignment) : null };
};

const getDoctorPatients = async (doctorId, requestingUser) => {
  if (!isObjectId(doctorId)) {
    throw createError(400, 'A valid doctorId is required.');
  }

  let doctor;
  if (canManageAssignments(requestingUser)) {
    doctor = await Doctor.findById(doctorId);
  } else if (requestingUser.role === 'DOCTOR') {
    doctor = await Doctor.findOne({ userId: requestingUser._id });
    if (!doctor || String(doctor._id) !== String(doctorId)) {
      throw createError(403, 'You may only view your own assigned patients.');
    }
    if (doctor.status !== 'ACTIVE') {
      throw createError(403, 'Inactive doctors cannot view assigned patients.');
    }
  } else {
    throw createError(403, 'You are not authorized to view a doctor patient list.');
  }

  if (!doctor) {
    throw createError(404, 'Doctor profile not found.');
  }

  const assignments = await DoctorAssignment.find({
    doctorId: doctor._id,
    assignmentType: 'TREATING',
    status: 'ACTIVE'
  });
  if (assignments.length === 0) {
    return { patients: [] };
  }

  const patientIds = assignments.map((assignment) => assignment.patientId);
  const patients = await Patient.find({ _id: { $in: patientIds } });
  const patientById = new Map(
    patients.map((patient) => [String(patient._id), patient])
  );

  return {
    patients: assignments.reduce((result, assignment) => {
      const patient = patientById.get(String(assignment.patientId));
      if (patient) {
        result.push({
          _id: patient._id,
          patientNumber: patient.patientNumber,
          name: patient.name,
          status: patient.status,
          assignmentId: assignment._id,
          assignmentStartDate: assignment.startDate
        });
      }
      return result;
    }, [])
  };
};

const restorePreviousAssignment = async (assignment, endDate) => {
  const currentActive = await DoctorAssignment.findOne({
    patientId: assignment.patientId,
    assignmentType: 'TREATING',
    status: 'ACTIVE'
  });
  if (currentActive) {
    return;
  }

  const result = await DoctorAssignment.updateOne(
    {
      _id: assignment._id,
      status: 'CLOSED',
      endDate
    },
    { $set: { status: 'ACTIVE', endDate: null } }
  );
  if (!result.acknowledged || result.matchedCount !== 1) {
    throw new Error('Previous assignment could not be restored.');
  }
};

const reassign = async (assignmentId, payload = {}, requestingUser) => {
  assertManager(requestingUser);
  if (!isObjectId(assignmentId)) {
    throw createError(400, 'A valid assignment id is required.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createError(400, 'Request body must be an object.');
  }
  if (!isObjectId(payload.doctorId)) {
    throw createError(400, 'A valid doctorId is required.');
  }
  if (!isObjectId(requestingUser._id)) {
    throw createError(401, 'Authenticated user identity is invalid.');
  }
  const startDate = parseStartDate(payload.startDate);

  try {
    let nextAssignment;
    if (supportsTransactions()) {
      await mongoose.connection.transaction(async (session) => {
        const current = await withSession(
          DoctorAssignment.findOne({
            _id: assignmentId,
            assignmentType: 'TREATING',
            status: 'ACTIVE'
          }),
          session
        );
        if (!current) {
          throw createError(404, 'Active assignment not found.');
        }
        await resolveActiveProfiles(current.patientId, payload.doctorId, session);
        if (String(current.doctorId) === String(payload.doctorId)) {
          throw createError(409, 'Patient is already assigned to this doctor.');
        }
        if (startDate < current.startDate) {
          throw createError(400, 'Reassignment startDate cannot precede the current assignment.');
        }

        current.status = 'CLOSED';
        current.endDate = startDate;
        await current.save({ session });

        nextAssignment = newTreatingAssignment(
          current.patientId,
          payload.doctorId,
          requestingUser._id,
          startDate
        );
        await nextAssignment.save({ session });
      });
    } else {
      const current = await DoctorAssignment.findOne({
        _id: assignmentId,
        assignmentType: 'TREATING',
        status: 'ACTIVE'
      });
      if (!current) {
        throw createError(404, 'Active assignment not found.');
      }
      await resolveActiveProfiles(current.patientId, payload.doctorId);
      if (String(current.doctorId) === String(payload.doctorId)) {
        throw createError(409, 'Patient is already assigned to this doctor.');
      }
      if (startDate < current.startDate) {
        throw createError(400, 'Reassignment startDate cannot precede the current assignment.');
      }

      try {
        const closeResult = await DoctorAssignment.updateOne(
          {
            _id: current._id,
            assignmentType: 'TREATING',
            status: 'ACTIVE'
          },
          { $set: { status: 'CLOSED', endDate: startDate } }
        );
        if (!closeResult.acknowledged || closeResult.matchedCount !== 1) {
          throw createError(409, 'Active assignment changed; reload and retry.');
        }

        nextAssignment = newTreatingAssignment(
          current.patientId,
          payload.doctorId,
          requestingUser._id,
          startDate
        );
        await nextAssignment.save();
      } catch (error) {
        try {
          await restorePreviousAssignment(current, startDate);
        } catch (rollbackError) {
          const failure = createError(
            500,
            'Reassignment failed and the previous assignment could not be restored.'
          );
          failure.cause = error;
          failure.rollbackError = rollbackError;
          throw failure;
        }
        throw error;
      }
    }

    await recordAudit({
      actorId: requestingUser._id,
      action: 'DOCTOR_PATIENT_REASSIGNED',
      resourceType: 'DoctorAssignment',
      resourceId: nextAssignment._id,
      accessType: 'MANAGEMENT'
    });
    return safeAssignment(nextAssignment);
  } catch (error) {
    throw normalizeDatabaseError(
      error,
      'Patient already has an active treating-doctor assignment.'
    );
  }
};

const listAssignments = async (requestingUser, query = {}) => {
  assertManager(requestingUser);
  const filter = {};
  if (query.status && ['ACTIVE', 'CLOSED'].includes(query.status.toUpperCase())) {
    filter.status = query.status.toUpperCase();
  }
  if (query.patientId && isObjectId(query.patientId)) {
    filter.patientId = query.patientId;
  }
  if (query.doctorId && isObjectId(query.doctorId)) {
    filter.doctorId = query.doctorId;
  }

  const queryObj = DoctorAssignment.find(filter);
  const assignments = typeof queryObj.sort === 'function'
    ? await queryObj.sort({ startDate: -1, createdAt: -1 })
    : await queryObj;

  if (!assignments || assignments.length === 0) {
    return { assignments: [] };
  }

  const patientIds = [...new Set(assignments.map((a) => String(a.patientId)))];
  const doctorIds = [...new Set(assignments.map((a) => String(a.doctorId)))];

  const fetchPatients = async (ids) => {
    const q = Patient.find({ _id: { $in: ids } });
    if (typeof q.select === 'function') {
      return q.select('_id name patientNumber contactNumber status').lean();
    }
    return q;
  };

  const fetchDoctors = async (ids) => {
    try {
      const q = Doctor.find({ _id: { $in: ids } });
      if (q && typeof q.select === 'function') {
        return await q.select('_id name doctorNumber specialization department status').lean();
      }
      const res = await q;
      if (Array.isArray(res) && res.length > 0) return res;
    } catch (_) {}
    return Promise.all(ids.map((id) => Doctor.findById(id)));
  };

  const [patients, doctors] = await Promise.all([
    fetchPatients(patientIds),
    fetchDoctors(doctorIds)
  ]);

  const patientMap = new Map((patients || []).filter(Boolean).map((p) => [String(p._id), p]));
  const doctorMap = new Map((doctors || []).filter(Boolean).map((d) => [String(d._id), d]));

  const enriched = assignments.map((assignment) => {
    const patient = patientMap.get(String(assignment.patientId));
    const doctor = doctorMap.get(String(assignment.doctorId));
    return {
      _id: assignment._id,
      patientId: assignment.patientId,
      doctorId: assignment.doctorId,
      assignmentType: assignment.assignmentType,
      startDate: assignment.startDate,
      endDate: assignment.endDate,
      status: assignment.status,
      assignedBy: assignment.assignedBy,
      createdAt: assignment.createdAt,
      updatedAt: assignment.updatedAt,
      patient: patient ? {
        _id: patient._id,
        name: patient.name,
        patientNumber: patient.patientNumber,
        contactNumber: patient.contactNumber,
        status: patient.status
      } : null,
      doctor: doctor ? {
        _id: doctor._id,
        name: doctor.name,
        doctorNumber: doctor.doctorNumber,
        specialization: doctor.specialization,
        department: doctor.department,
        status: doctor.status
      } : null
    };
  });

  return { assignments: enriched };
};

module.exports = {
  createAssignment,
  getPatientAssignment,
  getDoctorPatients,
  reassign,
  listAssignments
};
