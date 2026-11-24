'use strict';

const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const { recordAudit } = require('./audit.service');

const TRANSACTION_TOPOLOGIES = new Set([
  'ReplicaSetWithPrimary',
  'ReplicaSetNoPrimary',
  'Sharded'
]);

const createError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

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
      'Notification mutations require MongoDB replica-set or sharded transactions; no changes were made.'
    );
  }
  return mongoose.connection.transaction(operation);
};

const withSession = (query, session) =>
  session && query && typeof query.session === 'function'
    ? query.session(session)
    : query;

const recordNotificationAudit = async (event, session) => {
  try {
    await recordAudit(event, session);
  } catch (cause) {
    const error = createError(
      500,
      'Notification transaction could not be committed because audit logging failed.'
    );
    error.cause = cause;
    throw error;
  }
};

const isObjectId = (value) => {
  if (typeof value !== 'string' && !(value instanceof mongoose.Types.ObjectId)) {
    return false;
  }
  const asString = String(value);
  return mongoose.Types.ObjectId.isValid(asString) &&
    String(new mongoose.Types.ObjectId(asString)) === asString;
};

const parsePagination = (query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

const notificationResponse = (notification) => ({
  _id: notification._id,
  reviewId: notification.reviewId,
  type: notification.type,
  title: notification.title,
  message: notification.message,
  scheduledAt: notification.scheduledAt,
  sentAt: notification.sentAt,
  readAt: notification.readAt,
  status: notification.status,
  createdAt: notification.createdAt
});

const getMyNotifications = async (query = {}, requestingUser) => {
  if (!requestingUser || !['PATIENT', 'DOCTOR', 'PHARMACY'].includes(requestingUser.role)) {
    throw createError(403, 'You are not authorized to view notifications.');
  }
  const { page, limit, skip } = parsePagination(query);
  const filter = {
    recipientId: requestingUser._id,
    status: { $in: ['SENT', 'READ', 'FAILED'] }
  };
  const [notifications, total] = await Promise.all([
    Notification.find(filter)
      .sort({ sentAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter)
  ]);
  await recordAudit({
    actorId: requestingUser._id,
    action: 'NOTIFICATIONS_ACCESSED',
    resourceType: 'NotificationList',
    resourceId: requestingUser._id,
    accessType: 'SELF_SERVICE'
  });
  return {
    notifications: notifications.map(notificationResponse),
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
};

const markAsRead = async (notificationId, requestingUser, now = new Date()) => {
  if (!requestingUser || !['PATIENT', 'DOCTOR', 'PHARMACY'].includes(requestingUser.role)) {
    throw createError(403, 'You are not authorized to update notifications.');
  }
  if (!isObjectId(notificationId)) {
    throw createError(400, 'A valid notification ID is required.');
  }

  return withRequiredTransaction(async (session) => {
    const updated = await Notification.findOneAndUpdate(
      {
        _id: notificationId,
        recipientId: requestingUser._id,
        status: 'SENT'
      },
      { $set: { status: 'READ', readAt: now } },
      { new: true, session }
    );
    if (updated) {
      await recordNotificationAudit({
        actorId: requestingUser._id,
        action: 'NOTIFICATION_READ',
        resourceType: 'Notification',
        resourceId: updated._id,
        accessType: 'SELF_SERVICE'
      }, session);
      return notificationResponse(updated);
    }

    const existing = await withSession(
      Notification.findOne({
        _id: notificationId,
        recipientId: requestingUser._id
      }),
      session
    );
    if (!existing) {
      throw createError(404, 'Notification not found.');
    }
    if (existing.status === 'READ') {
      return notificationResponse(existing);
    }
    throw createError(409, 'Only sent notifications can be marked as read.');
  });
};

module.exports = {
  getMyNotifications,
  markAsRead
};
