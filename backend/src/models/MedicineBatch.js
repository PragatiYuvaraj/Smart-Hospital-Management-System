'use strict';

const mongoose = require('mongoose');

const medicineBatchSchema = new mongoose.Schema(
  {
    medicineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medicine',
      required: [true, 'Medicine is required'],
      immutable: true
    },
    batchNumber: {
      type: String,
      required: [true, 'Batch number is required'],
      trim: true,
      uppercase: true,
      maxlength: [100, 'Batch number cannot exceed 100 characters'],
      immutable: true
    },
    expiryDate: {
      type: Date,
      required: [true, 'Expiry date is required'],
      immutable: true,
      validate: {
        validator: (date) => date instanceof Date && !Number.isNaN(date.getTime()),
        message: 'A valid expiry date is required'
      }
    },
    receivedQuantity: {
      type: Number,
      required: [true, 'Received quantity is required'],
      min: [1, 'Received quantity must be positive'],
      validate: {
        validator: Number.isSafeInteger,
        message: 'Received quantity must be a whole number'
      },
      immutable: true
    },
    availableQuantity: {
      type: Number,
      required: true,
      min: [0, 'Available quantity cannot be negative'],
      validate: [
        {
          validator: Number.isSafeInteger,
          message: 'Available quantity must be a whole number'
        },
        {
          validator: function (quantity) {
            return quantity <= this.receivedQuantity;
          },
          message: 'Available quantity cannot exceed received quantity'
        }
      ]
    },
    receivedAt: {
      type: Date,
      default: Date.now,
      required: true,
      immutable: true
    },
    supplierReference: {
      type: String,
      trim: true,
      maxlength: [100, 'Supplier reference cannot exceed 100 characters']
    }
  },
  { timestamps: true }
);

medicineBatchSchema.index({ medicineId: 1, batchNumber: 1 }, { unique: true });
medicineBatchSchema.index({ medicineId: 1, expiryDate: 1 });

module.exports = mongoose.model('MedicineBatch', medicineBatchSchema);
