'use strict';

const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      immutable: true
    },
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Doctor',
      required: true,
      immutable: true
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'CLOSED'],
      default: 'ACTIVE',
      required: true
    },
    lastMessageAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

conversationSchema.index({ patientId: 1, doctorId: 1 }, { unique: true });
conversationSchema.index({ patientId: 1, updatedAt: -1, _id: -1 });
conversationSchema.index({ doctorId: 1, updatedAt: -1, _id: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
