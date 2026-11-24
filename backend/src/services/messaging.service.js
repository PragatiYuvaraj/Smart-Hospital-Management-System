'use strict';

const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Doctor = require('../models/Doctor');
const DoctorAssignment = require('../models/DoctorAssignment');
const Message = require('../models/Message');
const Patient = require('../models/Patient');
const User = require('../models/User');
const { recordAudit } = require('./audit.service');

const MAX_MESSAGE_LENGTH = 4000;
const MAX_PAGE_SIZE = 100;
const TRANSACTION_TOPOLOGIES = new Set([
  'ReplicaSetWithPrimary',
  'ReplicaSetNoPrimary',
  'Sharded'
]);

const createError = (statusCode, message, errors = []) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errors = errors;
  return error;
};

const createAccessError = (
  statusCode,
  message,
  { resourceType = 'MessagingAccess', resourceId, accessType = 'UNAUTHORIZED' } = {}
) => {
  const error = createError(statusCode, message);
  error.auditDenied = true;
  error.auditResourceType = resourceType;
  error.auditResourceId = resourceId;
  error.auditAccessType = accessType;
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

const withSession = (query, session) =>
  session && query && typeof query.session === 'function'
    ? query.session(session)
    : query;

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
      'Messaging mutations require MongoDB replica-set or sharded transactions; no changes were made.'
    );
  }
  return mongoose.connection.transaction(operation);
};

const recordMessagingAudit = async (event, session) => {
  try {
    await recordAudit(event, session);
  } catch (cause) {
    const error = createError(
      500,
      'Messaging audit could not be saved; the requested operation was not completed.'
    );
    error.cause = cause;
    throw error;
  }
};

const getRequestIp = (context) => {
  const value = context && context.ipAddress;
  return typeof value === 'string' && value.length <= 45 ? value : undefined;
};

const withDeniedAccessAudit = async (user, context, operation) => {
  try {
    return await operation();
  } catch (error) {
    if (error.auditDenied && user && isObjectId(user._id)) {
      const resourceId = isObjectId(error.auditResourceId)
        ? error.auditResourceId
        : user._id;
      await recordMessagingAudit({
        actorId: user._id,
        action: 'MESSAGING_ACCESS_DENIED',
        resourceType: error.auditResourceType || 'MessagingAccess',
        resourceId,
        accessType: error.auditAccessType || 'UNAUTHORIZED',
        outcome: 'FAILURE',
        ipAddress: getRequestIp(context)
      });
    }
    throw error;
  }
};

const assertMessagingRole = (user) => {
  if (!user || !isObjectId(user._id)) {
    throw createError(401, 'Authentication required.');
  }
  if (!['PATIENT', 'DOCTOR'].includes(user.role)) {
    throw createAccessError(403, 'Only patients and doctors can use messaging.', {
      accessType: 'ROLE_DENIED'
    });
  }
};

const assertObjectPayload = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createError(400, 'Request body must be an object.');
  }
};

const assertAllowedKeys = (payload, allowedKeys) => {
  const extraKeys = Object.keys(payload).filter((key) => !allowedKeys.includes(key));
  if (extraKeys.length === 0) return;

  const identityFieldProvided = extraKeys.some((key) =>
    ['patientId', 'doctorId', 'senderId', 'recipientId'].includes(key)
  );
  if (identityFieldProvided) {
    throw createAccessError(400, 'Participant identities must not be supplied by the client.', {
      accessType: 'IDENTITY_FIELDS_REJECTED'
    });
  }
  throw createError(400, 'Request contains unsupported fields.');
};

const parsePagination = (query = {}) => {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw createError(400, 'Pagination query must be an object.');
  }
  assertAllowedKeys(query, ['page', 'limit']);

  const parseValue = (value, defaultValue, field) => {
    if (value === undefined) return defaultValue;
    if (
      typeof value !== 'string' ||
      !/^[1-9]\d*$/.test(value) ||
      !Number.isSafeInteger(Number(value))
    ) {
      throw createError(400, `${field} must be a positive integer.`);
    }
    return Number(value);
  };

  const page = parseValue(query.page, 1, 'page');
  const requestedLimit = parseValue(query.limit, 20, 'limit');
  const limit = Math.min(requestedLimit, MAX_PAGE_SIZE);
  const skip = (page - 1) * limit;
  if (!Number.isSafeInteger(skip)) {
    throw createError(400, 'Pagination values are too large.');
  }
  return { page, limit, skip };
};

const getActiveDoctorProfile = async (user, session) => {
  if (user.role !== 'DOCTOR') {
    throw createAccessError(403, 'Only doctors can access this conversation.', {
      accessType: 'ROLE_DENIED'
    });
  }
  const doctor = await withSession(Doctor.findOne({ userId: user._id }), session);
  if (!doctor || doctor.status !== 'ACTIVE') {
    throw createAccessError(403, 'An active doctor profile is required for messaging.', {
      accessType: 'DOCTOR_PROFILE_REQUIRED'
    });
  }
  return doctor;
};

const getPatientProfile = async (user, session, requireActive = false) => {
  const patient = await withSession(Patient.findOne({ userId: user._id }), session);
  if (!patient || (requireActive && patient.status !== 'ACTIVE')) {
    throw createAccessError(403, 'An active patient profile is required for this operation.', {
      accessType: 'PATIENT_PROFILE_REQUIRED'
    });
  }
  return patient;
};

const findActiveTreatingAssignment = (doctorId, patientId, session) =>
  withSession(
    DoctorAssignment.findOne({
      doctorId,
      patientId,
      assignmentType: 'TREATING',
      status: 'ACTIVE'
    }),
    session
  );

const assertActiveParticipantUser = async (profile, expectedRole, session) => {
  const user = await withSession(User.findById(profile.userId), session);
  if (!user || user.role !== expectedRole || user.status !== 'ACTIVE') {
    throw createError(409, 'The other conversation participant is unavailable.');
  }
  return user;
};

const resolveConversationPair = async (payload, user, session) => {
  if (user.role === 'PATIENT') {
    assertAllowedKeys(payload, []);
    const patient = await getPatientProfile(user, session, true);
    const assignment = await withSession(
      DoctorAssignment.findOne({
        patientId: patient._id,
        assignmentType: 'TREATING',
        status: 'ACTIVE'
      }),
      session
    );
    if (!assignment) {
      throw createError(409, 'An active treating-doctor assignment is required to start a conversation.');
    }
    const doctor = await withSession(Doctor.findById(assignment.doctorId), session);
    if (!doctor || doctor.status !== 'ACTIVE') {
      throw createError(409, 'The assigned treating doctor is unavailable.');
    }
    await assertActiveParticipantUser(doctor, 'DOCTOR', session);
    return { patient, doctor };
  }

  assertAllowedKeys(payload, ['patientId']);
  if (!isObjectId(payload.patientId)) {
    throw createError(400, 'A valid patientId is required.');
  }

  const doctor = await getActiveDoctorProfile(user, session);
  const patient = await withSession(Patient.findById(payload.patientId), session);
  if (!patient || patient.status !== 'ACTIVE') {
    throw createError(404, 'Active patient profile not found.');
  }
  const assignment = await findActiveTreatingAssignment(doctor._id, patient._id, session);
  if (!assignment) {
    throw createAccessError(
      403,
      'You must have an active treating assignment to message this patient.',
      {
        resourceType: 'Patient',
        resourceId: patient._id,
        accessType: 'ACTIVE_TREATING_ASSIGNMENT_REQUIRED'
      }
    );
  }
  await assertActiveParticipantUser(patient, 'PATIENT', session);
  return { patient, doctor };
};

const getConversationById = async (conversationId, session) => {
  if (!isObjectId(conversationId)) {
    throw createError(400, 'A valid conversation ID is required.');
  }
  const conversation = await withSession(Conversation.findById(conversationId), session);
  if (!conversation) {
    throw createAccessError(404, 'Conversation not found.', {
      resourceType: 'Conversation',
      resourceId: conversationId,
      accessType: 'CONVERSATION_NOT_FOUND'
    });
  }
  return conversation;
};

const assertConversationAccess = async (conversation, user, session) => {
  if (user.role === 'PATIENT') {
    const patient = await getPatientProfile(user, session);
    if (String(patient._id) !== String(conversation.patientId)) {
      throw createAccessError(403, 'You are not authorized to access this conversation.', {
        resourceType: 'Conversation',
        resourceId: conversation._id,
        accessType: 'PATIENT_OWNERSHIP_REQUIRED'
      });
    }
    return { patient };
  }

  const doctor = await getActiveDoctorProfile(user, session);
  if (String(doctor._id) !== String(conversation.doctorId)) {
    throw createAccessError(403, 'You are not authorized to access this conversation.', {
      resourceType: 'Conversation',
      resourceId: conversation._id,
      accessType: 'ACTIVE_TREATING_ASSIGNMENT_REQUIRED'
    });
  }
  const assignment = await findActiveTreatingAssignment(
    doctor._id,
    conversation.patientId,
    session
  );
  if (!assignment) {
    throw createAccessError(403, 'An active treating assignment is required to access this conversation.', {
      resourceType: 'Conversation',
      resourceId: conversation._id,
      accessType: 'ACTIVE_TREATING_ASSIGNMENT_REQUIRED'
    });
  }
  return { doctor };
};

const toMessageResponse = (message) => ({
  _id: String(message._id),
  conversationId: String(message.conversationId),
  senderId: String(message.senderId),
  recipientId: String(message.recipientId),
  body: message.body,
  createdAt: message.createdAt,
  readAt: message.readAt || null,
  status: message.status
});

const toConversationSummary = async (conversation, session) => {
  const [patient, doctor, latestMessage] = await Promise.all([
    withSession(Patient.findById(conversation.patientId), session),
    withSession(Doctor.findById(conversation.doctorId), session),
    withSession(
      Message.findOne({ conversationId: conversation._id })
        .sort({ createdAt: -1, _id: -1 })
        .lean(),
      session
    )
  ]);
  if (!patient || !doctor) {
    throw createError(500, 'Conversation participant profile is unavailable.');
  }

  const preview = latestMessage
    ? Array.from(latestMessage.body).slice(0, 120).join('')
    : null;
  return {
    _id: String(conversation._id),
    status: conversation.status,
    lastMessageAt: conversation.lastMessageAt || null,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    participants: {
      patient: {
        id: String(patient._id),
        name: patient.name,
        role: 'PATIENT'
      },
      doctor: {
        id: String(doctor._id),
        name: doctor.name,
        role: 'DOCTOR'
      }
    },
    latestMessage: latestMessage
      ? {
          _id: String(latestMessage._id),
          senderId: String(latestMessage.senderId),
          body: preview,
          truncated: Array.from(latestMessage.body).length > 120,
          createdAt: latestMessage.createdAt,
          readAt: latestMessage.readAt || null,
          status: latestMessage.status
        }
      : null
  };
};

const getConversationAccessType = (user) =>
  user.role === 'PATIENT' ? 'PATIENT_SELF_SERVICE' : 'ACTIVE_TREATING_DOCTOR';

const createOrGetConversation = async (payload, user, context = {}) =>
  withDeniedAccessAudit(user, context, async () => {
    assertMessagingRole(user);
    const requestBody = payload === undefined ? {} : payload;
    assertObjectPayload(requestBody);

    const createOrRetrieve = () => withRequiredTransaction(async (session) => {
      const { patient, doctor } = await resolveConversationPair(requestBody, user, session);
      const pair = { patientId: patient._id, doctorId: doctor._id };
      const existing = await withSession(Conversation.findOne(pair), session);
      if (existing) {
        await recordMessagingAudit({
          actorId: user._id,
          action: 'CONVERSATION_ACCESSED',
          resourceType: 'Conversation',
          resourceId: existing._id,
          accessType: getConversationAccessType(user),
          ipAddress: getRequestIp(context)
        }, session);
        return { conversation: existing, created: false };
      }

      const conversation = new Conversation({
        ...pair,
        status: 'ACTIVE',
        lastMessageAt: null
      });
      await conversation.save({ session });
      await recordMessagingAudit({
        actorId: user._id,
        action: 'CONVERSATION_CREATED',
        resourceType: 'Conversation',
        resourceId: conversation._id,
        accessType: getConversationAccessType(user),
        ipAddress: getRequestIp(context)
      }, session);
      return { conversation, created: true };
    });

    let result;
    try {
      result = await createOrRetrieve();
    } catch (error) {
      if (error.code !== 11000) throw error;
      result = await withRequiredTransaction(async (session) => {
        const { patient, doctor } = await resolveConversationPair(requestBody, user, session);
        const conversation = await withSession(
          Conversation.findOne({ patientId: patient._id, doctorId: doctor._id }),
          session
        );
        if (!conversation) {
          throw createError(409, 'Conversation creation conflicted with another request.');
        }
        await recordMessagingAudit({
          actorId: user._id,
          action: 'CONVERSATION_ACCESSED',
          resourceType: 'Conversation',
          resourceId: conversation._id,
          accessType: getConversationAccessType(user),
          ipAddress: getRequestIp(context)
        }, session);
        return { conversation, created: false };
      });
    }

    return {
      conversation: await toConversationSummary(result.conversation),
      created: result.created
    };
  });

const listConversations = async (query, user, context = {}) =>
  withDeniedAccessAudit(user, context, async () => {
    assertMessagingRole(user);
    const { page, limit, skip } = parsePagination(query);
    let filter;
    let accessType;

    if (user.role === 'PATIENT') {
      const patient = await getPatientProfile(user);
      filter = { patientId: patient._id };
      accessType = 'PATIENT_SELF_SERVICE';
    } else {
      const doctor = await getActiveDoctorProfile(user);
      const assignments = await DoctorAssignment.find({
        doctorId: doctor._id,
        assignmentType: 'TREATING',
        status: 'ACTIVE'
      }).select('patientId').lean();
      const patientIds = assignments.map((assignment) => assignment.patientId);
      filter = { doctorId: doctor._id, patientId: { $in: patientIds } };
      accessType = 'ACTIVE_TREATING_DOCTOR';
    }

    const [conversations, total] = await Promise.all([
      Conversation.find(filter)
        .sort({ updatedAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Conversation.countDocuments(filter)
    ]);

    const summaries = await Promise.all(
      conversations.map((conversation) => toConversationSummary(conversation))
    );
    await recordMessagingAudit({
      actorId: user._id,
      action: 'CONVERSATIONS_ACCESSED',
      resourceType: 'ConversationList',
      resourceId: user._id,
      accessType,
      ipAddress: getRequestIp(context)
    });
    return {
      conversations: summaries,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  });

const getMessages = async (conversationId, query, user, context = {}) =>
  withDeniedAccessAudit(user, context, async () => {
    assertMessagingRole(user);
    const { page, limit, skip } = parsePagination(query);
    const conversation = await getConversationById(conversationId);
    await assertConversationAccess(conversation, user);
    const filter = { conversationId: conversation._id };
    const [messages, total] = await Promise.all([
      Message.find(filter)
        .sort({ createdAt: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Message.countDocuments(filter)
    ]);
    await recordMessagingAudit({
      actorId: user._id,
      action: 'MESSAGES_ACCESSED',
      resourceType: 'Conversation',
      resourceId: conversation._id,
      accessType: getConversationAccessType(user),
      ipAddress: getRequestIp(context)
    });
    return {
      messages: messages.map(toMessageResponse),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  });

const validateMessagePayload = (payload) => {
  assertObjectPayload(payload);
  assertAllowedKeys(payload, ['body']);
  if (typeof payload.body !== 'string') {
    throw createError(400, 'Message body must be a string.');
  }
  const body = payload.body.trim();
  const length = body.length;
  if (length === 0) {
    throw createError(400, 'Message body cannot be empty.');
  }
  if (length > MAX_MESSAGE_LENGTH) {
    throw createError(400, `Message body cannot exceed ${MAX_MESSAGE_LENGTH} characters.`);
  }
  return body;
};

const getMessageParticipants = async (conversation, user, session) => {
  const patient = await withSession(Patient.findById(conversation.patientId), session);
  const doctor = await withSession(Doctor.findById(conversation.doctorId), session);
  if (!patient || !doctor) {
    throw createError(409, 'Conversation participant profile is unavailable.');
  }

  const isPatientSender = user.role === 'PATIENT';
  const senderId = isPatientSender ? patient.userId : doctor.userId;
  const recipientId = isPatientSender ? doctor.userId : patient.userId;
  if (String(senderId) !== String(user._id)) {
    throw createAccessError(403, 'Authenticated user is not a conversation participant.', {
      resourceType: 'Conversation',
      resourceId: conversation._id,
      accessType: 'PARTICIPANT_IDENTITY_MISMATCH'
    });
  }

  if (patient.status !== 'ACTIVE' || doctor.status !== 'ACTIVE') {
    throw createError(409, 'Conversation participants must have active profiles to send messages.');
  }
  await assertActiveParticipantUser(
    isPatientSender ? doctor : patient,
    isPatientSender ? 'DOCTOR' : 'PATIENT',
    session
  );
  return { senderId, recipientId };
};

const sendMessage = async (conversationId, payload, user, context = {}) =>
  withDeniedAccessAudit(user, context, async () => {
    assertMessagingRole(user);
    const body = validateMessagePayload(payload);
    if (!isObjectId(conversationId)) {
      throw createError(400, 'A valid conversation ID is required.');
    }

    const message = await withRequiredTransaction(async (session) => {
      const conversation = await getConversationById(conversationId, session);
      await assertConversationAccess(conversation, user, session);
      if (conversation.status !== 'ACTIVE') {
        throw createError(409, 'Messages cannot be sent to a closed conversation.');
      }
      const { senderId, recipientId } = await getMessageParticipants(
        conversation,
        user,
        session
      );
      const createdAt = new Date();
      const newMessage = new Message({
        conversationId: conversation._id,
        senderId,
        recipientId,
        body,
        createdAt,
        readAt: null,
        status: 'SENT'
      });
      await newMessage.save({ session });
      conversation.lastMessageAt = newMessage.createdAt;
      await conversation.save({ session });
      await recordMessagingAudit({
        actorId: user._id,
        action: 'MESSAGE_SENT',
        resourceType: 'Message',
        resourceId: newMessage._id,
        accessType: getConversationAccessType(user),
        ipAddress: getRequestIp(context)
      }, session);
      return newMessage;
    });
    return { message: toMessageResponse(message) };
  });

const markMessageRead = async (conversationId, messageId, user, context = {}) =>
  withDeniedAccessAudit(user, context, async () => {
    assertMessagingRole(user);
    if (!isObjectId(conversationId)) {
      throw createError(400, 'A valid conversation ID is required.');
    }
    if (!isObjectId(messageId)) {
      throw createError(400, 'A valid message ID is required.');
    }

    const message = await withRequiredTransaction(async (session) => {
      const conversation = await getConversationById(conversationId, session);
      await assertConversationAccess(conversation, user, session);
      const currentMessage = await withSession(
        Message.findOne({ _id: messageId, conversationId: conversation._id }),
        session
      );
      if (!currentMessage) {
        throw createAccessError(404, 'Message not found in this conversation.', {
          resourceType: 'Conversation',
          resourceId: conversation._id,
          accessType: 'MESSAGE_CONVERSATION_MISMATCH'
        });
      }
      if (String(currentMessage.recipientId) !== String(user._id)) {
        throw createAccessError(403, 'Only the message recipient can mark it as read.', {
          resourceType: 'Message',
          resourceId: currentMessage._id,
          accessType: 'RECIPIENT_REQUIRED'
        });
      }

      if (!currentMessage.readAt || currentMessage.status !== 'READ') {
        currentMessage.readAt = currentMessage.readAt || new Date();
        currentMessage.status = 'READ';
        await currentMessage.save({ session });
      }
      await recordMessagingAudit({
        actorId: user._id,
        action: 'MESSAGE_READ',
        resourceType: 'Message',
        resourceId: currentMessage._id,
        accessType: 'RECIPIENT',
        ipAddress: getRequestIp(context)
      }, session);
      return currentMessage;
    });
    return { message: toMessageResponse(message) };
  });

module.exports = {
  createOrGetConversation,
  getMessages,
  listConversations,
  markMessageRead,
  sendMessage
};
