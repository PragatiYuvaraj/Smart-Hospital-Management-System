'use strict';

const mongoose = require('mongoose');

const accessContextSchema = new mongoose.Schema(
  {
    accessType: {
      type: String,
      trim: true,
      maxlength: [50, 'Access type cannot exceed 50 characters']
    }
  },
  { _id: false, strict: 'throw' }
);

const auditLogSchema = new mongoose.Schema(
  {
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Audit actor is required']
    },
    action: {
      type: String,
      required: [true, 'Action is required'],
      trim: true,
      maxlength: [100, 'Action cannot exceed 100 characters']
    },
    resourceType: {
      type: String,
      required: [true, 'Resource type is required'],
      trim: true,
      maxlength: [100, 'Resource type cannot exceed 100 characters']
    },
    resourceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'Resource ID is required']
    },
    timestamp: {
      type: Date,
      default: Date.now,
      required: true
    },
    outcome: {
      type: String,
      enum: {
        values: ['SUCCESS', 'FAILURE'],
        message: 'Outcome must be SUCCESS or FAILURE'
      },
      required: [true, 'Outcome is required']
    },
    accessContext: {
      type: accessContextSchema,
      default: () => ({})
    },
    ipAddress: {
      type: String,
      trim: true,
      maxlength: [45, 'IP address cannot exceed 45 characters']
    }
  },
  { timestamps: true }
);

auditLogSchema.index({ resourceType: 1, resourceId: 1, timestamp: -1 });
auditLogSchema.index({ actorId: 1, timestamp: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
