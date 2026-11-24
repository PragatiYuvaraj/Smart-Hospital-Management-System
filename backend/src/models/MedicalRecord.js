'use strict';

const mongoose = require('mongoose');

const amendmentSchema = new mongoose.Schema(
  {
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Amendment user ID is required'],
      immutable: true
    },
    authorDoctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Doctor',
      required: [true, 'Amendment doctor ID is required'],
      immutable: true
    },
    authorName: {
      type: String,
      required: [true, 'Author name is required'],
      trim: true,
      maxlength: [100, 'Author name cannot exceed 100 characters'],
      immutable: true
    },
    reason: {
      type: String,
      required: [true, 'Amendment justification reason is required'],
      trim: true,
      minlength: [5, 'Reason must be at least 5 characters'],
      maxlength: [500, 'Reason cannot exceed 500 characters'],
      immutable: true
    },
    changes: {
      type: mongoose.Schema.Types.Mixed,
      required: [true, 'Description or delta of changes is required'],
      immutable: true
    },
    createdAt: {
      type: Date,
      default: Date.now,
      required: true,
      immutable: true
    }
  },
  { _id: true, strict: 'throw' }
);

const medicalRecordSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: [true, 'Patient reference is required'],
      immutable: true,
      index: true
    },
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Doctor',
      required: [true, 'Attending doctor reference is required'],
      immutable: true,
      index: true
    },
    encounterDate: {
      type: Date,
      default: Date.now,
      required: [true, 'Encounter date is required']
    },
    reason: {
      type: String,
      required: [true, 'Reason for consultation is required'],
      trim: true,
      maxlength: [200, 'Reason cannot exceed 200 characters']
    },
    symptoms: {
      type: String,
      required: [true, 'Symptoms description is required'],
      trim: true,
      maxlength: [2000, 'Symptoms cannot exceed 2000 characters']
    },
    observations: {
      type: String,
      trim: true,
      maxlength: [2000, 'Observations cannot exceed 2000 characters']
    },
    diagnosis: {
      type: String,
      required: [true, 'Diagnosis is required'],
      trim: true,
      maxlength: [500, 'Diagnosis cannot exceed 500 characters']
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [5000, 'Clinical notes cannot exceed 5000 characters']
    },
    treatmentPlan: {
      type: String,
      required: [true, 'Treatment plan is required'],
      trim: true,
      maxlength: [3000, 'Treatment plan cannot exceed 3000 characters']
    },
    status: {
      type: String,
      enum: {
        values: ['DRAFT', 'FINALIZED'],
        message: 'Status must be either DRAFT or FINALIZED'
      },
      default: 'DRAFT',
      required: true,
      index: true
    },
    isReleased: {
      type: Boolean,
      default: false,
      required: true,
      index: true,
      validate: {
        validator: function (value) {
          return !(this.status === 'DRAFT' && value === true);
        },
        message: 'A draft consultation cannot be released to the patient'
      }
    },
    releasedAt: {
      type: Date,
      default: null
    },
    releasedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    amendments: {
      type: [amendmentSchema],
      default: []
    }
  },
  {
    timestamps: true,
    optimisticConcurrency: true
  }
);

medicalRecordSchema.index({ patientId: 1, encounterDate: -1 });
medicalRecordSchema.index({ doctorId: 1, encounterDate: -1 });
medicalRecordSchema.index({ patientId: 1, status: 1, isReleased: 1 });

module.exports = mongoose.model('MedicalRecord', medicalRecordSchema);
