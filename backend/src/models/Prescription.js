'use strict';

const mongoose = require('mongoose');

const prescriptionItemSchema = new mongoose.Schema(
  {
    medicineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medicine',
      required: [true, 'Medicine is required']
    },
    dosage: {
      type: String,
      required: [true, 'Dosage is required'],
      trim: true,
      maxlength: [100, 'Dosage cannot exceed 100 characters']
    },
    route: {
      type: String,
      trim: true,
      maxlength: [50, 'Route cannot exceed 50 characters']
    },
    frequency: {
      type: String,
      required: [true, 'Frequency is required'],
      trim: true,
      maxlength: [100, 'Frequency cannot exceed 100 characters']
    },
    duration: {
      type: String,
      required: [true, 'Duration is required'],
      trim: true,
      maxlength: [100, 'Duration cannot exceed 100 characters']
    },
    quantity: {
      type: Number,
      required: [true, 'Prescribed quantity is required'],
      min: [1, 'Prescribed quantity must be positive'],
      validate: {
        validator: Number.isSafeInteger,
        message: 'Prescribed quantity must be a whole number'
      }
    },
    dispensedQuantity: {
      type: Number,
      default: 0,
      min: [0, 'Dispensed quantity cannot be negative'],
      validate: [
        {
          validator: Number.isSafeInteger,
          message: 'Dispensed quantity must be a whole number'
        },
        {
          validator: function (quantity) {
            return quantity <= this.quantity;
          },
          message: 'Dispensed quantity cannot exceed prescribed quantity'
        }
      ]
    },
    instructions: {
      type: String,
      trim: true,
      maxlength: [500, 'Instructions cannot exceed 500 characters']
    }
  },
  { _id: false, strict: 'throw' }
);

const prescriptionSchema = new mongoose.Schema(
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
      required: [true, 'Prescribing doctor is required'],
      immutable: true
    },
    medicalRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MedicalRecord',
      required: [true, 'Consultation record is required'],
      immutable: true
    },
    items: {
      type: [prescriptionItemSchema],
      required: [true, 'At least one prescribed medicine is required'],
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: 'A prescription must contain at least one medicine'
      }
    },
    issuedAt: {
      type: Date,
      default: Date.now,
      required: true,
      immutable: true
    },
    status: {
      type: String,
      enum: {
        values: ['PENDING', 'PARTIALLY_DISPENSED', 'DISPENSED', 'CANCELLED'],
        message: 'Invalid prescription status'
      },
      default: 'PENDING',
      required: true
    }
  },
  { timestamps: true, optimisticConcurrency: true }
);

prescriptionSchema.index({ status: 1, issuedAt: 1 });
prescriptionSchema.index({ patientId: 1, issuedAt: -1 });
prescriptionSchema.index({ doctorId: 1, issuedAt: -1 });

module.exports = mongoose.model('Prescription', prescriptionSchema);
