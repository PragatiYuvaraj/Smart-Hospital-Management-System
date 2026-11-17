'use strict';

const mongoose = require('mongoose');

const doctorAssignmentSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      immutable: true,
      required: [true, 'Patient is required']
    },
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Doctor',
      immutable: true,
      required: [true, 'Doctor is required']
    },
    assignmentType: {
      type: String,
      required: [true, 'Assignment type is required'],
      immutable: true,
      trim: true,
      uppercase: true,
      maxlength: [50, 'Assignment type cannot exceed 50 characters']
    },
    startDate: {
      type: Date,
      immutable: true,
      required: [true, 'Start date is required']
    },
    endDate: {
      type: Date,
      default: null,
      validate: {
        validator: function (date) {
          return date == null || date >= this.startDate;
        },
        message: 'End date cannot be before the start date'
      }
    },
    status: {
      type: String,
      enum: {
        values: ['ACTIVE', 'CLOSED'],
        message: 'Status must be ACTIVE or CLOSED'
      },
      default: 'ACTIVE',
      required: true
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      immutable: true,
      required: [true, 'Assigning user is required']
    }
  },
  { timestamps: true }
);

doctorAssignmentSchema.index({ patientId: 1, status: 1, startDate: -1 });
doctorAssignmentSchema.index({ doctorId: 1, status: 1, startDate: -1 });
doctorAssignmentSchema.index(
  { patientId: 1, assignmentType: 1 },
  {
    unique: true,
    partialFilterExpression: {
      assignmentType: 'TREATING',
      status: 'ACTIVE'
    }
  }
);

module.exports = mongoose.model('DoctorAssignment', doctorAssignmentSchema);
