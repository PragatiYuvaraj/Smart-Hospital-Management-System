'use strict';

const mongoose = require('mongoose');
const DoctorAssignment = require('../models/DoctorAssignment');
const Notification = require('../models/Notification');
const Patient = require('../models/Patient');
const ReviewSchedule = require('../models/ReviewSchedule');
const User = require('../models/User');
const env = require('../config/env');
const { recordAudit } = require('./audit.service');
const {
  getActiveDoctorProfile,
  verifyDoctorPatientAuthorization
} = require('./medicalRecord.service');
const {
  calculateReminderDate,
  formatReviewDate,
  parseReviewDate
} = require('../utils/review-time');

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
      'Review and reminder mutations require MongoDB replica-set or sharded transactions; no changes were made.'
    );
  }
  return mongoose.connection.transaction(operation);
};

const withSession = (query, session) =>
  session && query && typeof query.session === 'function'
    ? query.session(session)
    : query;

const recordReviewAudit = async (event, session) => {
  try {
    await recordAudit(event, session);
  } catch (cause) {
    const error = createError(
      500,
      'Review transaction could not be committed because audit logging failed.'
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

const isDutyDoctor = (user) =>
  user.role === 'DOCTOR' && (user.permissions || []).includes('DUTY_DOCTOR');

const resolveSchedule = async (
  patientId,
  requestingUser,
  { allowInactivePatient = false } = {},
  session
) => {
  const doctor = await getActiveDoctorProfile(requestingUser, session);
  const patient = await withSession(Patient.findById(patientId), session);
  if (!patient) {
    throw createError(404, 'Patient profile not found.');
  }
  if (!allowInactivePatient && patient.status !== 'ACTIVE') {
    throw createError(409, 'Reviews cannot be scheduled for an inactive patient.');
  }

  const patientUser = await withSession(User.findById(patient.userId), session);
  if (
    !patientUser ||
    patientUser.role !== 'PATIENT' ||
    (!allowInactivePatient && patientUser.status !== 'ACTIVE')
  ) {
    throw createError(409, 'Patient profile is not linked to an active patient account.');
  }

  const accessType = await verifyDoctorPatientAuthorization(
    doctor,
    patient._id,
    requestingUser,
    session
  );
  return { doctor, patient, patientUser, accessType };
};

const validateScheduleWindow = (reviewDate, now) => {
  if (reviewDate <= now) {
    throw createError(400, 'Review date must be in the future.');
  }

  let reminderAt;
  try {
    reminderAt = calculateReminderDate(reviewDate, env.HOSPITAL_TIMEZONE);
  } catch (cause) {
    const error = createError(500, 'The configured hospital timezone is invalid.');
    error.cause = cause;
    throw error;
  }
  if (reminderAt <= now) {
    throw createError(400, 'Review must be scheduled far enough ahead for its two-day reminder.');
  }
  return reminderAt;
};

const normalizeInstructions = (instructions) => {
  if (instructions === undefined) return '';
  if (typeof instructions !== 'string') {
    throw createError(400, 'instructions must be a string.');
  }
  const normalized = instructions.trim();
  if (normalized.length > 2000) {
    throw createError(400, 'Review instructions cannot exceed 2000 characters.');
  }
  return normalized;
};

const deduplicationKeyFor = (review) =>
  `review-reminder:${String(review._id)}:${review.reminderGeneration}`;

const reminderMessageFor = (reviewDate) =>
  `You have a scheduled hospital review on ${formatReviewDate(
    reviewDate,
    env.HOSPITAL_TIMEZONE
  )}.`;

const reminderNotificationFields = (review, recipientId) => ({
  recipientId,
  reviewId: review._id,
  type: 'REVIEW_REMINDER',
  title: 'Upcoming review reminder',
  message: reminderMessageFor(review.reviewDate),
  scheduledAt: review.reminderAt,
  sentAt: null,
  readAt: null,
  status: 'SCHEDULED',
  deduplicationKey: deduplicationKeyFor(review)
});

const ensurePendingReminder = async (review, recipientId, session) => {
  const fields = reminderNotificationFields(review, recipientId);
  const pending = await Notification.findOneAndUpdate(
    { reviewId: review._id, type: 'REVIEW_REMINDER', status: 'SCHEDULED' },
    { $set: fields },
    { new: true, sort: { scheduledAt: 1 }, session }
  );
  if (pending) return pending;

  return Notification.findOneAndUpdate(
    { deduplicationKey: fields.deduplicationKey },
    { $setOnInsert: fields },
    { new: true, upsert: true, setDefaultsOnInsert: true, session }
  );
};

const toReviewResponse = (review) => ({
  _id: review._id,
  reviewDate: review.reviewDate,
  instructions: review.instructions,
  status: review.status,
  reminderStatus: review.reminderStatus,
  reminderAt: review.reminderAt,
  createdAt: review.createdAt,
  updatedAt: review.updatedAt
});

const parsePagination = (query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

const createReview = async (payload, requestingUser, now = new Date()) => {
  if (requestingUser.role !== 'DOCTOR') {
    throw createError(403, 'Only doctors can schedule patient reviews.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createError(400, 'Request body must be an object.');
  }
  if (!isObjectId(payload.patientId)) {
    throw createError(400, 'A valid patientId is required.');
  }

  const reviewDate = parseReviewDate(payload.reviewDate);
  const reminderAt = validateScheduleWindow(reviewDate, now);
  const instructions = normalizeInstructions(payload.instructions);
  return withRequiredTransaction(async (session) => {
    const { doctor, patient, patientUser, accessType } = await resolveSchedule(
      payload.patientId,
      requestingUser,
      {},
      session
    );

    const review = new ReviewSchedule({
      patientId: patient._id,
      doctorId: doctor._id,
      reviewDate,
      instructions,
      status: 'SCHEDULED',
      reminderAt,
      reminderStatus: 'SCHEDULED',
      reminderGeneration: 1
    });
    await review.save({ session });
    await ensurePendingReminder(review, patientUser._id, session);
    await recordReviewAudit({
      actorId: requestingUser._id,
      action: 'REVIEW_SCHEDULED',
      resourceType: 'ReviewSchedule',
      resourceId: review._id,
      accessType
    }, session);
    return toReviewResponse(review);
  });
};

const getUpcomingReviews = async (query = {}, requestingUser) => {
  if (!requestingUser || !['PATIENT', 'DOCTOR'].includes(requestingUser.role)) {
    throw createError(403, 'You are not authorized to view review schedules.');
  }
  const { page, limit, skip } = parsePagination(query);
  let filter = { status: 'SCHEDULED' };
  let accessType;

  if (requestingUser.role === 'PATIENT') {
    const patient = await Patient.findOne({ userId: requestingUser._id });
    if (!patient) {
      throw createError(404, 'Patient profile not found.');
    }
    filter.patientId = patient._id;
    accessType = 'SELF_SERVICE';
  } else {
    const doctor = await getActiveDoctorProfile(requestingUser);
    if (query.patientId !== undefined) {
      if (!isObjectId(query.patientId)) {
        throw createError(400, 'A valid patientId is required.');
      }
      const patient = await Patient.findById(query.patientId);
      if (!patient) {
        throw createError(404, 'Patient profile not found.');
      }
      accessType = await verifyDoctorPatientAuthorization(
        doctor,
        patient._id,
        requestingUser
      );
      filter.patientId = patient._id;
    } else if (!isDutyDoctor(requestingUser)) {
      const assignments = await DoctorAssignment.find({
        doctorId: doctor._id,
        assignmentType: 'TREATING',
        status: 'ACTIVE'
      }).select('patientId').lean();
      const patientIds = assignments.map((assignment) => assignment.patientId);
      filter.patientId = { $in: patientIds };
      accessType = 'ASSIGNED_DOCTOR';
    } else {
      accessType = 'DUTY_DOCTOR_COVERAGE';
    }
  }

  const [reviews, total] = await Promise.all([
    ReviewSchedule.find(filter)
      .sort({ reviewDate: 1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ReviewSchedule.countDocuments(filter)
  ]);
  await recordAudit({
    actorId: requestingUser._id,
    action: 'REVIEWS_ACCESSED',
    resourceType: 'ReviewScheduleList',
    resourceId: requestingUser._id,
    accessType
  });
  return {
    reviews: reviews.map(toReviewResponse),
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
};

const findAuthorizedReview = async (
  reviewId,
  requestingUser,
  { allowInactivePatient = false } = {},
  session
) => {
  if (!isObjectId(reviewId)) {
    throw createError(400, 'A valid review ID is required.');
  }
  const review = await withSession(ReviewSchedule.findById(reviewId), session);
  if (!review) {
    throw createError(404, 'Review not found.');
  }
  const { accessType } = await resolveSchedule(review.patientId, requestingUser, {
    allowInactivePatient
  }, session);
  return { review, accessType };
};

const rescheduleReview = async (reviewId, payload, requestingUser, now = new Date()) => {
  if (requestingUser.role !== 'DOCTOR') {
    throw createError(403, 'Only doctors can reschedule patient reviews.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createError(400, 'Request body must be an object.');
  }

  return withRequiredTransaction(async (session) => {
    const { review, accessType } = await findAuthorizedReview(
      reviewId,
      requestingUser,
      {},
      session
    );
    if (review.status !== 'SCHEDULED') {
      throw createError(409, 'Only scheduled reviews can be rescheduled.');
    }

    const reviewDate = payload.reviewDate === undefined
      ? review.reviewDate
      : parseReviewDate(payload.reviewDate);
    const reminderAt = validateScheduleWindow(reviewDate, now);
    const instructions = normalizeInstructions(
      payload.instructions === undefined ? review.instructions : payload.instructions
    );
    if (
      reviewDate.getTime() === new Date(review.reviewDate).getTime() &&
      instructions === review.instructions
    ) {
      return toReviewResponse(review);
    }

    review.reviewDate = reviewDate;
    review.instructions = instructions;
    review.reminderAt = reminderAt;
    review.reminderStatus = 'SCHEDULED';
    review.reminderGeneration += 1;
    await review.save({ session });

    const patient = await withSession(Patient.findById(review.patientId), session);
    if (!patient) {
      throw createError(404, 'Patient profile not found.');
    }
    await ensurePendingReminder(review, patient.userId, session);
    await recordReviewAudit({
      actorId: requestingUser._id,
      action: 'REVIEW_RESCHEDULED',
      resourceType: 'ReviewSchedule',
      resourceId: review._id,
      accessType
    }, session);
    return toReviewResponse(review);
  });
};

const transitionReview = async (reviewId, requestingUser, status, auditAction) => {
  if (requestingUser.role !== 'DOCTOR') {
    throw createError(403, 'Only doctors can update patient review status.');
  }
  return withRequiredTransaction(async (session) => {
    const { review, accessType } = await findAuthorizedReview(
      reviewId,
      requestingUser,
      { allowInactivePatient: true },
      session
    );
    if (review.status !== 'SCHEDULED') {
      throw createError(409, 'Only scheduled reviews can be updated.');
    }

    review.status = status;
    if (review.reminderStatus === 'SCHEDULED') {
      review.reminderStatus = 'CANCELLED';
    }
    await review.save({ session });
    await Notification.updateMany(
      { reviewId: review._id, status: 'SCHEDULED' },
      { $set: { status: 'CANCELLED' } },
      { session }
    );
    await recordReviewAudit({
      actorId: requestingUser._id,
      action: auditAction,
      resourceType: 'ReviewSchedule',
      resourceId: review._id,
      accessType
    }, session);
    return toReviewResponse(review);
  });
};

const cancelReview = (reviewId, requestingUser) =>
  transitionReview(reviewId, requestingUser, 'CANCELLED', 'REVIEW_CANCELLED');

const completeReview = (reviewId, requestingUser) =>
  transitionReview(reviewId, requestingUser, 'COMPLETED', 'REVIEW_COMPLETED');

const cancelPendingNotification = async (notification, session) => {
  const result = await Notification.updateOne(
    { _id: notification._id, status: 'SCHEDULED' },
    { $set: { status: 'CANCELLED' } },
    { session }
  );
  return Boolean(result.matchedCount);
};

const processDueReviewReminders = async (now = new Date()) => {
  if (mongoose.connection.readyState !== 1) {
    return { processed: 0, skipped: 0, failed: 0 };
  }
  const dueNotifications = await Notification.find({
    type: 'REVIEW_REMINDER',
    status: 'SCHEDULED',
    scheduledAt: { $lte: now }
  }).sort({ scheduledAt: 1, _id: 1 }).limit(100).lean();

  const result = { processed: 0, skipped: 0, failed: 0 };
  for (const notification of dueNotifications) {
    try {
      const processed = await withRequiredTransaction(async (session) => {
        const review = await withSession(
          ReviewSchedule.findById(notification.reviewId),
          session
        );
        if (!review || review.status !== 'SCHEDULED') {
          const cancelled = await cancelPendingNotification(notification, session);
          if (cancelled) {
            await recordReviewAudit({
              actorType: 'SYSTEM',
              action: 'REVIEW_REMINDER_CANCELLED',
              resourceType: 'Notification',
              resourceId: notification._id
            }, session);
          }
          return false;
        }

        const patient = await withSession(Patient.findById(review.patientId), session);
        const patientUser = patient
          ? await withSession(User.findById(patient.userId), session)
          : null;
        if (
          !patient ||
          patient.status !== 'ACTIVE' ||
          !patientUser ||
          patientUser.status !== 'ACTIVE' ||
          patientUser.role !== 'PATIENT'
        ) {
          const cancelled = await cancelPendingNotification(notification, session);
          await ReviewSchedule.updateOne(
            { _id: review._id, status: 'SCHEDULED' },
            { $set: { reminderStatus: 'CANCELLED' } },
            { session }
          );
          if (cancelled) {
            await recordReviewAudit({
              actorType: 'SYSTEM',
              action: 'REVIEW_REMINDER_CANCELLED',
              resourceType: 'Notification',
              resourceId: notification._id
            }, session);
          }
          return false;
        }

        const expectedReminderAt = calculateReminderDate(
          review.reviewDate,
          env.HOSPITAL_TIMEZONE
        );
        if (
          notification.deduplicationKey !== deduplicationKeyFor(review) ||
          new Date(notification.scheduledAt).getTime() !== expectedReminderAt.getTime()
        ) {
          const reviewValues = typeof review.toObject === 'function' ? review.toObject() : review;
          const refreshed = await ensurePendingReminder(
            { ...reviewValues, reminderAt: expectedReminderAt },
            patientUser._id,
            session
          );
          if (!refreshed) {
            return false;
          }
          await recordReviewAudit({
            actorType: 'SYSTEM',
            action: 'REVIEW_REMINDER_RESCHEDULED',
            resourceType: 'Notification',
            resourceId: refreshed._id
          }, session);
          if (new Date(refreshed.scheduledAt) > now) return false;
        }
        if (expectedReminderAt > now) {
          return false;
        }

        const sent = await Notification.findOneAndUpdate(
          {
            _id: notification._id,
            type: 'REVIEW_REMINDER',
            status: 'SCHEDULED',
            deduplicationKey: deduplicationKeyFor(review),
            scheduledAt: { $lte: now }
          },
          { $set: { status: 'SENT', sentAt: now } },
          { new: true, session }
        );
        if (!sent) return false;

        const reviewUpdate = await ReviewSchedule.updateOne(
          {
            _id: review._id,
            status: 'SCHEDULED',
            reminderGeneration: review.reminderGeneration
          },
          { $set: { reminderStatus: 'SENT' } },
          { session }
        );
        if (!reviewUpdate.matchedCount) {
          throw createError(409, 'Review changed while its reminder was being processed.');
        }
        await recordReviewAudit({
          actorType: 'SYSTEM',
          action: 'REVIEW_REMINDER_SENT',
          resourceType: 'Notification',
          resourceId: sent._id
        }, session);
        return true;
      });
      if (processed) result.processed++;
      else result.skipped++;
    } catch (error) {
      result.failed++;
      console.error('[Review Reminder] Processing failed; the scheduled reminder will be retried.', {
        notificationId: String(notification._id),
        errorName: error.name,
        code: error.code
      });
    }
  }
  return result;
};

module.exports = {
  cancelReview,
  completeReview,
  createReview,
  getUpcomingReviews,
  processDueReviewReminders,
  rescheduleReview
};
