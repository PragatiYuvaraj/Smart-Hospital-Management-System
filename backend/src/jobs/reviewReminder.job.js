'use strict';

const cron = require('node-cron');
const mongoose = require('mongoose');
const env = require('../config/env');
const { processDueReviewReminders } = require('../services/review.service');

let scheduledTask = null;
let isRunning = false;

const runReminderCycle = async () => {
  if (isRunning || mongoose.connection.readyState !== 1) return;
  isRunning = true;
  try {
    const result = await processDueReviewReminders();
    if (result.failed > 0) {
      console.warn(`[Review Reminder] ${result.failed} reminder(s) will be retried.`);
    }
  } catch (error) {
    console.error('[Review Reminder] Cycle failed; it will retry on the next schedule.', {
      errorName: error.name,
      code: error.code
    });
  } finally {
    isRunning = false;
  }
};

const startReviewReminderJob = () => {
  if (env.NODE_ENV === 'test') return null;
  if (scheduledTask) return scheduledTask;
  scheduledTask = cron.schedule('* * * * *', runReminderCycle, {
    timezone: env.HOSPITAL_TIMEZONE
  });
  void runReminderCycle();
  return scheduledTask;
};

module.exports = {
  runReminderCycle,
  startReviewReminderJob
};
