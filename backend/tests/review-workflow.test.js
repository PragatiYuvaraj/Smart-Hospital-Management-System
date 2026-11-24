'use strict';

const assert = require('assert');
const mongoose = require('mongoose');
const DoctorAssignment = require('../src/models/DoctorAssignment');
const Notification = require('../src/models/Notification');
const Patient = require('../src/models/Patient');
const ReviewSchedule = require('../src/models/ReviewSchedule');
const User = require('../src/models/User');
const AuditLog = require('../src/models/AuditLog');
const medicalRecordService = require('../src/services/medicalRecord.service');
const auditService = require('../src/services/audit.service');
const env = require('../src/config/env');
const cron = require('node-cron');

const ids = {
  doctor: new mongoose.Types.ObjectId(),
  patient: new mongoose.Types.ObjectId(),
  patientUser: new mongoose.Types.ObjectId(),
  otherPatient: new mongoose.Types.ObjectId(),
  otherPatientUser: new mongoose.Types.ObjectId(),
  doctorUser: new mongoose.Types.ObjectId(),
  otherUser: new mongoose.Types.ObjectId()
};
const patient = { _id: ids.patient, userId: ids.patientUser, status: 'ACTIVE' };
const otherPatient = {
  _id: ids.otherPatient,
  userId: ids.otherPatientUser,
  status: 'ACTIVE'
};
const patientUser = { _id: ids.patientUser, role: 'PATIENT', status: 'ACTIVE' };
const doctor = { _id: ids.doctor, status: 'ACTIVE' };
const doctorUser = { _id: ids.doctorUser, role: 'DOCTOR', permissions: [] };
const patients = new Map([
  [String(ids.patient), patient],
  [String(ids.otherPatient), otherPatient]
]);
const users = new Map([[String(ids.patientUser), patientUser]]);
const reviews = new Map();
const notifications = new Map();
let activeAssignments = [];
let unauthorized = false;
const authorizationRequests = [];
let failAuditAction = null;
const auditEvents = [];
let passed = 0;
let reviewService;
let originalProcessReminders;
let originalNodeEnv;
let failReminderStatusUpdate = false;
const mockSession = { mockedTransaction: true };

const originals = {
  assignmentFind: DoctorAssignment.find,
  patientFindById: Patient.findById,
  patientFindOne: Patient.findOne,
  userFindById: User.findById,
  reviewFindById: ReviewSchedule.findById,
  reviewFind: ReviewSchedule.find,
  reviewCountDocuments: ReviewSchedule.countDocuments,
  reviewUpdateOne: ReviewSchedule.updateOne,
  reviewSave: ReviewSchedule.prototype.save,
  notificationFind: Notification.find,
  notificationFindOne: Notification.findOne,
  notificationFindOneAndUpdate: Notification.findOneAndUpdate,
  notificationUpdateOne: Notification.updateOne,
  notificationUpdateMany: Notification.updateMany,
  notificationCountDocuments: Notification.countDocuments,
  doctorProfile: medicalRecordService.getActiveDoctorProfile,
  authorizePatient: medicalRecordService.verifyDoctorPatientAuthorization,
  recordAudit: auditService.recordAudit,
  readyState: Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState'),
  client: Object.getOwnPropertyDescriptor(mongoose.connection, 'client'),
  transaction: Object.getOwnPropertyDescriptor(mongoose.connection, 'transaction')
};

const asId = (value) => String(value);
const matches = (record, filter) => Object.entries(filter).every(([key, value]) => {
  if (value && typeof value === 'object' && value.$lte !== undefined) {
    return new Date(record[key]) <= value.$lte;
  }
  if (value && typeof value === 'object' && value.$in) {
    return value.$in.some((candidate) => asId(record[key]) === asId(candidate));
  }
  return asId(record[key]) === asId(value);
});

const makeQuery = (getRows) => {
  let sort = null;
  let skip = 0;
  let limit = Number.MAX_SAFE_INTEGER;
  return {
    sort(value) { sort = value; return this; },
    select() { return this; },
    skip(value) { skip = value; return this; },
    limit(value) { limit = value; return this; },
    lean() {
      let rows = getRows();
      if (sort) {
        rows = rows.slice().sort((left, right) => {
          for (const [field, direction] of Object.entries(sort)) {
            const a = new Date(left[field]).getTime();
            const b = new Date(right[field]).getTime();
            if (a !== b) return (a < b ? -1 : 1) * direction;
          }
          return 0;
        });
      }
      return Promise.resolve(rows.slice(skip, skip + limit));
    }
  };
};

const applyUpdate = (record, update) => {
  if (update.$set) Object.assign(record, update.$set);
  if (update.$setOnInsert) Object.assign(record, update.$setOnInsert);
  return record;
};

const test = async (description, operation) => {
  await operation();
  passed++;
  console.log(`  PASS: ${description}`);
};

const run = async () => {
  medicalRecordService.getActiveDoctorProfile = async () => doctor;
  medicalRecordService.verifyDoctorPatientAuthorization = async (
    requestingDoctor,
    patientId,
    requestingUser
  ) => {
    authorizationRequests.push({
      doctorId: requestingDoctor._id,
      patientId,
      userId: requestingUser._id
    });
    if (unauthorized) {
      const error = new Error('Forbidden');
      error.statusCode = 403;
      throw error;
    }
    return (requestingUser.permissions || []).includes('DUTY_DOCTOR')
      ? 'DUTY_DOCTOR_COVERAGE'
      : 'ASSIGNED_DOCTOR';
  };
  auditService.recordAudit = async (event, session) => {
    auditEvents.push({ event, session });
    if (event.action === failAuditAction) {
      throw new Error('Simulated audit persistence failure');
    }
  };
  Patient.findById = async (id) => patients.get(asId(id)) || null;
  Patient.findOne = async (filter) =>
    Array.from(patients.values()).find(
      (item) => asId(item.userId) === asId(filter.userId)
    ) || null;
  User.findById = async (id) => users.get(asId(id)) || null;
  DoctorAssignment.find = () => makeQuery(() => activeAssignments);
  ReviewSchedule.prototype.save = async function () {
    reviews.set(asId(this._id), this);
    return this;
  };
  ReviewSchedule.findById = async (id) => reviews.get(asId(id)) || null;
  ReviewSchedule.find = (filter) => makeQuery(() =>
    Array.from(reviews.values()).filter((item) => matches(item, filter))
  );
  ReviewSchedule.countDocuments = async (filter) =>
    Array.from(reviews.values()).filter((item) => matches(item, filter)).length;
  ReviewSchedule.updateOne = async (filter, update) => {
    if (failReminderStatusUpdate && update.$set && update.$set.reminderStatus === 'SENT') {
      failReminderStatusUpdate = false;
      throw new Error('Simulated review reminder status persistence failure');
    }
    const review = reviews.get(asId(filter._id));
    if (review && matches(review, filter)) applyUpdate(review, update);
    return { matchedCount: review && matches(review, filter) ? 1 : 0 };
  };
  Notification.find = (filter) => makeQuery(() =>
    Array.from(notifications.values()).filter((item) => matches(item, filter))
  );
  Notification.countDocuments = async (filter) =>
    Array.from(notifications.values()).filter((item) => matches(item, filter)).length;
  Notification.findOne = async (filter) =>
    Array.from(notifications.values()).find((item) => matches(item, filter)) || null;
  Notification.findOneAndUpdate = async (filter, update, options = {}) => {
    let item = Array.from(notifications.values()).find((candidate) =>
      matches(candidate, filter)
    );
    if (!item && options.upsert) {
      item = { _id: new mongoose.Types.ObjectId() };
      applyUpdate(item, update);
      notifications.set(asId(item._id), item);
      return item;
    }
    if (!item) return null;
    applyUpdate(item, update);
    return item;
  };
  Notification.updateOne = async (filter, update) => {
    const item = Array.from(notifications.values()).find((candidate) =>
      matches(candidate, filter)
    );
    if (item) applyUpdate(item, update);
    return { matchedCount: item ? 1 : 0 };
  };
  Notification.updateMany = async (filter, update) => {
    const items = Array.from(notifications.values()).filter((candidate) =>
      matches(candidate, filter)
    );
    items.forEach((item) => applyUpdate(item, update));
    return { modifiedCount: items.length };
  };
  Object.defineProperty(mongoose.connection, 'readyState', {
    configurable: true,
    value: 1
  });
  Object.defineProperty(mongoose.connection, 'client', {
    configurable: true,
    value: { topology: { description: { type: 'ReplicaSetWithPrimary' } } }
  });
  Object.defineProperty(mongoose.connection, 'transaction', {
    configurable: true,
    value: async (operation) => {
      const savedReviews = new Map(reviews);
      const savedReviewValues = new Map(
        Array.from(reviews, ([key, review]) => [
          key,
          typeof review.toObject === 'function' ? review.toObject() : { ...review }
        ])
      );
      const savedNotifications = new Map(notifications);
      const savedNotificationValues = new Map(
        Array.from(notifications, ([key, notification]) => [key, { ...notification }])
      );
      try {
        return await operation(mockSession);
      } catch (error) {
        reviews.clear();
        for (const [key, review] of savedReviews) {
          const values = savedReviewValues.get(key);
          if (typeof review.set === 'function') review.set(values);
          else Object.assign(review, values);
          reviews.set(key, review);
        }
        notifications.clear();
        for (const [key, notification] of savedNotifications) {
          Object.assign(notification, savedNotificationValues.get(key));
          notifications.set(key, notification);
        }
        throw error;
      }
    }
  });
  originalNodeEnv = env.NODE_ENV;

  const service = require('../src/services/review.service');
  reviewService = service;
  originalProcessReminders = service.processDueReviewReminders;
  const notificationService = require('../src/services/notification.service');
  const { calculateReminderDate } = require('../src/utils/review-time');
  const initialDate = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
  const dateValue = initialDate.toISOString();

  console.log('  NOTE: Scheduler checks invoke mocked cycles; no live cron expression is started.');

  await test('fails closed without transaction-capable MongoDB before writing', async () => {
    mongoose.connection.client.topology.description.type = 'Single';
    await assert.rejects(
      service.createReview({
        patientId: String(ids.patient),
        reviewDate: dateValue
      }, doctorUser),
      { statusCode: 503 }
    );
    mongoose.connection.client.topology.description.type = 'ReplicaSetWithPrimary';
    assert.strictEqual(reviews.size, 0);
    assert.strictEqual(notifications.size, 0);
  });

  await test('audit records support explicit system attribution without a fake user actor', async () => {
    const systemEvent = new AuditLog({
      actorType: 'SYSTEM',
      action: 'REVIEW_REMINDER_SENT',
      resourceType: 'Notification',
      resourceId: new mongoose.Types.ObjectId(),
      outcome: 'SUCCESS'
    });
    const userEvent = new AuditLog({
      action: 'REVIEW_SCHEDULED',
      resourceType: 'ReviewSchedule',
      resourceId: new mongoose.Types.ObjectId(),
      outcome: 'SUCCESS'
    });
    assert.strictEqual(systemEvent.validateSync(), undefined);
    assert.strictEqual(Boolean(userEvent.validateSync().errors.actorId), true);
  });

  await test('rolls back review and reminder when the audit write fails', async () => {
    failAuditAction = 'REVIEW_SCHEDULED';
    await assert.rejects(
      service.createReview({
        patientId: String(ids.patient),
        reviewDate: dateValue
      }, doctorUser),
      { statusCode: 500 }
    );
    failAuditAction = null;
    assert.strictEqual(reviews.size, 0);
    assert.strictEqual(notifications.size, 0);
  });

  await test('creates an authorized doctor review with a two-calendar-day reminder', async () => {
    const result = await service.createReview({
      patientId: String(ids.patient),
      reviewDate: dateValue,
      instructions: 'Follow up'
    }, doctorUser);
    assert.strictEqual(result.status, 'SCHEDULED');
    assert.strictEqual(result.reminderStatus, 'SCHEDULED');
    assert.strictEqual(reviews.size, 1);
    assert.strictEqual(notifications.size, 1);
    const audit = auditEvents.filter((item) => item.event.action === 'REVIEW_SCHEDULED').pop();
    assert.strictEqual(audit.session, mockSession);
    const reminder = Array.from(notifications.values())[0];
    assert.strictEqual(
      new Date(reminder.scheduledAt).getTime(),
      calculateReminderDate(new Date(dateValue), 'Asia/Kolkata').getTime()
    );
  });

  await test('patients see only their own upcoming reviews; pharmacy cannot list reviews', async () => {
    const patientReviews = await service.getUpcomingReviews({
      patientId: String(ids.otherPatient)
    }, patientUser);
    assert.strictEqual(patientReviews.total, 1);
    assert.strictEqual(
      asId(patientReviews.reviews[0]._id),
      asId(Array.from(reviews.values())[0]._id)
    );
    const selfAccessAudit = auditEvents.filter(
      (item) => item.event.action === 'REVIEWS_ACCESSED'
    ).pop();
    assert.strictEqual(asId(selfAccessAudit.event.actorId), asId(ids.patientUser));
    assert.strictEqual(selfAccessAudit.event.accessType, 'SELF_SERVICE');
    await assert.rejects(
      service.getUpcomingReviews({}, { _id: ids.otherUser, role: 'PHARMACY' }),
      { statusCode: 403 }
    );
  });

  await test('patients cannot create, reschedule, cancel or complete reviews', async () => {
    const review = Array.from(reviews.values())[0];
    const reviewId = String(review._id);
    const reviewCount = reviews.size;
    const notificationCount = notifications.size;
    const payload = {
      patientId: String(ids.patient),
      reviewDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
    };

    await assert.rejects(service.createReview(payload, patientUser), { statusCode: 403 });
    await assert.rejects(
      service.rescheduleReview(reviewId, payload, patientUser),
      { statusCode: 403 }
    );
    await assert.rejects(service.cancelReview(reviewId, patientUser), { statusCode: 403 });
    await assert.rejects(service.completeReview(reviewId, patientUser), { statusCode: 403 });

    assert.strictEqual(reviews.size, reviewCount);
    assert.strictEqual(notifications.size, notificationCount);
    assert.strictEqual(review.status, 'SCHEDULED');
  });

  await test('authorized treating doctors see only reviews for assigned patients', async () => {
    authorizationRequests.length = 0;
    const doctorReviews = await service.getUpcomingReviews({
      patientId: String(ids.patient),
      page: '1',
      limit: '10'
    }, doctorUser);
    assert.strictEqual(doctorReviews.total, 1);
    assert.strictEqual(doctorReviews.page, 1);
    assert.strictEqual(doctorReviews.totalPages, 1);
    assert.strictEqual(
      asId(doctorReviews.reviews[0]._id),
      asId(Array.from(reviews.values())[0]._id)
    );
    assert.strictEqual(authorizationRequests.length, 1);
    assert.strictEqual(asId(authorizationRequests[0].patientId), asId(ids.patient));
  });

  await test('rejects doctor filters for patients without assignment and allows duty coverage', async () => {
    unauthorized = true;
    await assert.rejects(
      service.getUpcomingReviews({ patientId: String(ids.otherPatient) }, doctorUser),
      { statusCode: 403 }
    );
    unauthorized = false;

    const dutyDoctor = {
      ...doctorUser,
      permissions: ['DUTY_DOCTOR']
    };
    const covered = await service.getUpcomingReviews({
      patientId: String(ids.otherPatient)
    }, dutyDoctor);
    assert.strictEqual(covered.total, 0);
    assert.strictEqual(
      auditEvents.filter((item) => item.event.action === 'REVIEWS_ACCESSED').pop()
        .event.accessType,
      'DUTY_DOCTOR_COVERAGE'
    );
  });

  await test('audits empty doctor review lists and denies pharmacy review mutations', async () => {
    const auditCount = auditEvents.length;
    const emptyResult = await service.getUpcomingReviews({}, doctorUser);
    assert.strictEqual(emptyResult.total, 0);
    const accessAudit = auditEvents.slice(auditCount).find(
      (item) => item.event.action === 'REVIEWS_ACCESSED'
    );
    assert.strictEqual(String(accessAudit.event.actorId), String(ids.doctorUser));

    const pharmacyUser = { _id: ids.otherUser, role: 'PHARMACY' };
    await assert.rejects(
      service.rescheduleReview(String(ids.patient), {}, pharmacyUser),
      { statusCode: 403 }
    );
    await assert.rejects(
      service.cancelReview(String(ids.patient), pharmacyUser),
      { statusCode: 403 }
    );
    await assert.rejects(
      service.completeReview(String(ids.patient), pharmacyUser),
      { statusCode: 403 }
    );
  });

  await test('rejects a doctor without patient authorization', async () => {
    unauthorized = true;
    await assert.rejects(
      service.createReview({
        patientId: String(ids.patient),
        reviewDate: dateValue
      }, doctorUser),
      { statusCode: 403 }
    );
    unauthorized = false;
    assert.strictEqual(reviews.size, 1);
  });

  await test('patient-filtered review pagination preserves totals and page boundaries', async () => {
    const laterReviewDate = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);
    const secondReview = new ReviewSchedule({
      patientId: ids.patient,
      doctorId: ids.doctor,
      reviewDate: laterReviewDate,
      instructions: '',
      status: 'SCHEDULED',
      reminderAt: new Date(laterReviewDate.getTime() - 2 * 24 * 60 * 60 * 1000),
      reminderStatus: 'SCHEDULED',
      reminderGeneration: 1
    });
    reviews.set(asId(secondReview._id), secondReview);

    const firstPage = await service.getUpcomingReviews({
      patientId: String(ids.patient),
      page: '1',
      limit: '1'
    }, doctorUser);
    const secondPage = await service.getUpcomingReviews({
      patientId: String(ids.patient),
      page: '2',
      limit: '1'
    }, doctorUser);
    assert.strictEqual(firstPage.total, 2);
    assert.strictEqual(firstPage.totalPages, 2);
    assert.strictEqual(firstPage.reviews.length, 1);
    assert.strictEqual(secondPage.page, 2);
    assert.strictEqual(secondPage.reviews.length, 1);
    assert.notStrictEqual(
      asId(firstPage.reviews[0]._id),
      asId(secondPage.reviews[0]._id)
    );
  });

  await test('reschedules a review and updates its pending reminder', async () => {
    const review = Array.from(reviews.values())[0];
    const rescheduledDate = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    await service.rescheduleReview(String(review._id), {
      reviewDate: rescheduledDate.toISOString()
    }, doctorUser);
    const audit = auditEvents.filter((item) => item.event.action === 'REVIEW_RESCHEDULED').pop();
    assert.strictEqual(review.reminderGeneration, 2);
    assert.strictEqual(audit.session, mockSession);
    assert.strictEqual(notifications.size, 1);
    assert.strictEqual(
      new Date(Array.from(notifications.values())[0].scheduledAt).getTime(),
      review.reminderAt.getTime()
    );
  });

  await test('cancels a review and its pending reminder', async () => {
    const review = Array.from(reviews.values())[0];
    await service.cancelReview(String(review._id), doctorUser);
    const audit = auditEvents.filter((item) => item.event.action === 'REVIEW_CANCELLED').pop();
    assert.strictEqual(review.status, 'CANCELLED');
    assert.strictEqual(audit.session, mockSession);
    assert.strictEqual(Array.from(notifications.values())[0].status, 'CANCELLED');
  });

  await test('allows authorized doctors to cancel reviews for inactive patients', async () => {
    const created = await service.createReview({
      patientId: String(ids.patient),
      reviewDate: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString()
    }, doctorUser);
    patient.status = 'INACTIVE';
    patientUser.status = 'INACTIVE';
    const cancelled = await service.cancelReview(String(created._id), doctorUser);
    patient.status = 'ACTIVE';
    patientUser.status = 'ACTIVE';
    assert.strictEqual(cancelled.status, 'CANCELLED');
  });

  await test('completing a review cancels its reminder before it becomes due', async () => {
    const created = await service.createReview({
      patientId: String(ids.patient),
      reviewDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    }, doctorUser);
    const review = reviews.get(asId(created._id));
    const notification = Array.from(notifications.values()).find(
      (item) => asId(item.reviewId) === asId(review._id)
    );
    const completed = await service.completeReview(String(review._id), doctorUser);
    const audit = auditEvents.filter((item) => item.event.action === 'REVIEW_COMPLETED').pop();
    assert.strictEqual(completed.status, 'COMPLETED');
    assert.strictEqual(audit.session, mockSession);
    assert.strictEqual(notification.status, 'CANCELLED');
  });

  await test('processes due reminders idempotently', async () => {
    const reviewDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const created = await service.createReview({
      patientId: String(ids.patient),
      reviewDate: reviewDate.toISOString()
    }, doctorUser);
    const review = reviews.get(asId(created._id));
    const notification = Array.from(notifications.values()).find(
      (item) => asId(item.reviewId) === asId(review._id)
    );
    const dueAt = new Date(review.reminderAt.getTime() + 1000);
    failReminderStatusUpdate = true;
    const failed = await service.processDueReviewReminders(dueAt);
    assert.strictEqual(failed.failed, 1);
    assert.strictEqual(notification.status, 'SCHEDULED');
    assert.strictEqual(review.reminderStatus, 'SCHEDULED');
    const first = await service.processDueReviewReminders(dueAt);
    const second = await service.processDueReviewReminders(dueAt);
    assert.strictEqual(first.processed, 1);
    assert.strictEqual(second.processed, 0);
    assert.strictEqual(notification.status, 'SENT');
    assert.strictEqual(review.reminderStatus, 'SENT');
    const systemAudit = auditEvents.filter(
      (item) => item.event.action === 'REVIEW_REMINDER_SENT'
    ).pop();
    assert.strictEqual(systemAudit.event.actorType, 'SYSTEM');
    assert.strictEqual(systemAudit.event.actorId, undefined);
    assert.strictEqual(systemAudit.session, mockSession);
  });

  await test('notification listing and mark-as-read are restricted to the recipient', async () => {
    const sent = Array.from(notifications.values()).find((item) => item.status === 'SENT');
    const listed = await notificationService.getMyNotifications({}, patientUser);
    assert.strictEqual(listed.total, 1);
    const listAudit = auditEvents.filter(
      (item) => item.event.action === 'NOTIFICATIONS_ACCESSED'
    ).pop();
    assert.strictEqual(asId(listAudit.event.actorId), asId(ids.patientUser));
    assert.strictEqual(listAudit.event.accessType, 'SELF_SERVICE');
    await assert.rejects(
      notificationService.markAsRead(String(sent._id), {
        _id: ids.otherUser,
        role: 'PATIENT'
      }),
      { statusCode: 404 }
    );
    mongoose.connection.client.topology.description.type = 'Single';
    await assert.rejects(
      notificationService.markAsRead(String(sent._id), patientUser),
      { statusCode: 503 }
    );
    mongoose.connection.client.topology.description.type = 'ReplicaSetWithPrimary';
    assert.strictEqual(sent.status, 'SENT');
    failAuditAction = 'NOTIFICATION_READ';
    await assert.rejects(
      notificationService.markAsRead(String(sent._id), patientUser),
      { statusCode: 500 }
    );
    failAuditAction = null;
    assert.strictEqual(sent.status, 'SENT');
    const read = await notificationService.markAsRead(String(sent._id), patientUser);
    assert.strictEqual(read.status, 'READ');
    assert.strictEqual(read.readAt instanceof Date, true);
    const audit = auditEvents.filter((item) => item.event.action === 'NOTIFICATION_READ').pop();
    assert.strictEqual(audit.session, mockSession);
    const pharmacyNotifications = await notificationService.getMyNotifications({}, {
      _id: ids.otherUser,
      role: 'PHARMACY'
    });
    assert.strictEqual(pharmacyNotifications.total, 0);
    const otherUserListAudit = auditEvents.filter(
      (item) => item.event.action === 'NOTIFICATIONS_ACCESSED'
    ).pop();
    assert.strictEqual(asId(otherUserListAudit.event.actorId), asId(ids.otherUser));
  });

  await test('scheduler skips overlapping cycles and can run repeatedly', async () => {
    const originalProcess = service.processDueReviewReminders;
    let calls = 0;
    let finishFirst;
    service.processDueReviewReminders = () => {
      calls++;
      if (calls === 1) {
        return new Promise((resolve) => {
          finishFirst = resolve;
        });
      }
      return Promise.resolve({ failed: 0, processed: 0, skipped: 0 });
    };
    const { runReminderCycle } = require('../src/jobs/reviewReminder.job');
    const firstCycle = runReminderCycle();
    await runReminderCycle();
    assert.strictEqual(calls, 1);
    finishFirst({ failed: 0, processed: 0, skipped: 0 });
    await firstCycle;
    await runReminderCycle();
    service.processDueReviewReminders = originalProcess;
    assert.strictEqual(calls, 2);
  });

  await test('scheduler startup is disabled in tests; cron execution remains mocked', async () => {
    env.NODE_ENV = 'test';
    const { startReviewReminderJob } = require('../src/jobs/reviewReminder.job');
    assert.strictEqual(startReviewReminderJob(), null);
    env.NODE_ENV = originalNodeEnv;
    assert.strictEqual(typeof cron.schedule, 'function');
  });

  await test('scheduler registers only one mocked cron task per process', async () => {
    const { startReviewReminderJob } = require('../src/jobs/reviewReminder.job');
    const originalSchedule = cron.schedule;
    const originalProcess = service.processDueReviewReminders;
    let registrations = 0;
    cron.schedule = () => {
      registrations++;
      return { stop() {} };
    };
    service.processDueReviewReminders = async () => ({
      failed: 0,
      processed: 0,
      skipped: 0
    });
    env.NODE_ENV = 'development';
    const firstTask = startReviewReminderJob();
    const secondTask = startReviewReminderJob();
    await new Promise((resolve) => setImmediate(resolve));
    cron.schedule = originalSchedule;
    service.processDueReviewReminders = originalProcess;
    env.NODE_ENV = originalNodeEnv;
    assert.strictEqual(registrations, 1);
    assert.strictEqual(secondTask, firstTask);
  });
};

run()
  .then(() => {
    console.log(`Review workflow tests: ${passed} passed.`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    DoctorAssignment.find = originals.assignmentFind;
    Patient.findById = originals.patientFindById;
    Patient.findOne = originals.patientFindOne;
    User.findById = originals.userFindById;
    ReviewSchedule.findById = originals.reviewFindById;
    ReviewSchedule.find = originals.reviewFind;
    ReviewSchedule.countDocuments = originals.reviewCountDocuments;
    ReviewSchedule.updateOne = originals.reviewUpdateOne;
    ReviewSchedule.prototype.save = originals.reviewSave;
    Notification.find = originals.notificationFind;
    Notification.findOne = originals.notificationFindOne;
    Notification.findOneAndUpdate = originals.notificationFindOneAndUpdate;
    Notification.updateOne = originals.notificationUpdateOne;
    Notification.updateMany = originals.notificationUpdateMany;
    Notification.countDocuments = originals.notificationCountDocuments;
    medicalRecordService.getActiveDoctorProfile = originals.doctorProfile;
    medicalRecordService.verifyDoctorPatientAuthorization = originals.authorizePatient;
    auditService.recordAudit = originals.recordAudit;
    if (reviewService && originalProcessReminders) {
      reviewService.processDueReviewReminders = originalProcessReminders;
    }
    if (originals.readyState) {
      Object.defineProperty(mongoose.connection, 'readyState', originals.readyState);
    } else {
      delete mongoose.connection.readyState;
    }
    if (originals.client) {
      Object.defineProperty(mongoose.connection, 'client', originals.client);
    } else {
      delete mongoose.connection.client;
    }
    if (originals.transaction) {
      Object.defineProperty(mongoose.connection, 'transaction', originals.transaction);
    } else {
      delete mongoose.connection.transaction;
    }
    env.NODE_ENV = originalNodeEnv;
  });
