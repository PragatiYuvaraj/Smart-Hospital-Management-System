'use strict';

const mongoose = require('mongoose');

const reviewScheduleSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: [true, 'Patient is required'],
      immutable: true
    },
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Doctor',
      required: [true, 'Responsible doctor is required'],
      immutable: true
    },
    reviewDate: {
      type: Date,
      required: [true, 'Review date is required']
    },
    instructions: {
      type: String,
      trim: true,
      maxlength: [2000, 'Review instructions cannot exceed 2000 characters'],
      default: ''
    },
    status: {
      type: String,
      enum: ['SCHEDULED', 'COMPLETED', 'CANCELLED'],
      default: 'SCHEDULED',
      required: true,
      index: true
    },
    reminderAt: {
      type: Date,
      required: [true, 'Reminder date is required']
    },
    reminderStatus: {
      type: String,
      enum: ['SCHEDULED', 'SENT', 'CANCELLED', 'FAILED'],
      default: 'SCHEDULED',
      required: true
    },
    reminderGeneration: {
      type: Number,
      default: 1,
      min: 1,
      required: true
    }
  },
  { timestamps: true }
);

reviewScheduleSchema.index({ patientId: 1, status: 1, reviewDate: 1 });
reviewScheduleSchema.index({ doctorId: 1, status: 1, reviewDate: 1 });
reviewScheduleSchema.index({ status: 1, reminderAt: 1 });

module.exports = mongoose.model('ReviewSchedule', reviewScheduleSchema);
