'use strict';

const mongoose = require('mongoose');

const MAX_MESSAGE_LENGTH = 4000;

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      immutable: true
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true
    },
    body: {
      type: String,
      required: [true, 'Message body is required'],
      trim: true,
      minlength: [1, 'Message body cannot be empty'],
      maxlength: [MAX_MESSAGE_LENGTH, `Message body cannot exceed ${MAX_MESSAGE_LENGTH} characters`]
    },
    readAt: {
      type: Date,
      default: null
    },
    status: {
      type: String,
      enum: ['SENT', 'READ'],
      default: 'SENT',
      required: true
    }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

messageSchema.index({ conversationId: 1, createdAt: 1, _id: 1 });
messageSchema.index({ recipientId: 1, readAt: 1, createdAt: -1 });
messageSchema.index({ senderId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
