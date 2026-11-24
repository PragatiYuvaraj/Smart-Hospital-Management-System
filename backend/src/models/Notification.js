'use strict';

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Notification recipient is required'],
      immutable: true
    },
    reviewId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ReviewSchedule',
      default: null
    },
    type: {
      type: String,
      enum: ['REVIEW_REMINDER'],
      required: true
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: [150, 'Notification title cannot exceed 150 characters']
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: [1000, 'Notification message cannot exceed 1000 characters']
    },
    scheduledAt: {
      type: Date,
      required: true,
      index: true
    },
    sentAt: {
      type: Date,
      default: null
    },
    readAt: {
      type: Date,
      default: null
    },
    status: {
      type: String,
      enum: ['SCHEDULED', 'SENT', 'READ', 'FAILED', 'CANCELLED'],
      default: 'SCHEDULED',
      required: true,
      index: true
    },
    deduplicationKey: {
      type: String,
      required: true
    }
  },
  { timestamps: true }
);

notificationSchema.index({ deduplicationKey: 1 }, { unique: true });
notificationSchema.index({ recipientId: 1, status: 1, sentAt: -1 });
notificationSchema.index({ status: 1, scheduledAt: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
