'use strict';

const mongoose = require('mongoose');

const stockTransactionSchema = new mongoose.Schema(
  {
    medicineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medicine',
      required: [true, 'Medicine is required'],
      immutable: true
    },
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MedicineBatch',
      required: [true, 'Medicine batch is required'],
      immutable: true
    },
    prescriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Prescription',
      default: null,
      immutable: true,
      validate: {
        validator: function (prescriptionId) {
          return this.transactionType === 'DISPENSING'
            ? Boolean(prescriptionId)
            : !prescriptionId;
        },
        message: 'Prescription reference must match the transaction type'
      }
    },
    transactionType: {
      type: String,
      required: [true, 'Transaction type is required'],
      enum: {
        values: ['RECEIPT', 'DISPENSING'],
        message: 'Transaction type must be RECEIPT or DISPENSING'
      },
      immutable: true
    },
    quantity: {
      type: Number,
      required: [true, 'Transaction quantity is required'],
      min: [1, 'Transaction quantity must be positive'],
      validate: {
        validator: Number.isSafeInteger,
        message: 'Transaction quantity must be a whole number'
      },
      immutable: true
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Transaction actor is required'],
      immutable: true
    },
    timestamp: {
      type: Date,
      default: Date.now,
      required: true,
      immutable: true
    },
    reason: {
      type: String,
      trim: true,
      maxlength: [200, 'Transaction reason cannot exceed 200 characters'],
      immutable: true
    }
  },
  { timestamps: true }
);

stockTransactionSchema.index({ batchId: 1, timestamp: -1 });
stockTransactionSchema.index({ prescriptionId: 1, timestamp: -1 });

module.exports = mongoose.model('StockTransaction', stockTransactionSchema);
