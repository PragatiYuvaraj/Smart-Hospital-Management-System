'use strict';

const mongoose = require('mongoose');

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

const documentVaultSchema = new mongoose.Schema(
  {
    ownerDoctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Doctor',
      required: true,
      immutable: true
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true
    },
    originalFilename: {
      type: String,
      required: true,
      trim: true,
      maxlength: [255, 'Display filename cannot exceed 255 characters']
    },
    storageKey: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      select: false,
      match: [/^[a-f0-9]{64}$/, 'Storage key is invalid']
    },
    mimeType: {
      type: String,
      enum: ALLOWED_MIME_TYPES,
      required: true
    },
    fileSize: {
      type: Number,
      required: true,
      min: 1,
      max: MAX_FILE_SIZE
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
      required: true,
      immutable: true
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'DELETED'],
      default: 'ACTIVE',
      required: true
    }
  },
  { timestamps: true }
);

documentVaultSchema.index({ ownerDoctorId: 1, status: 1, uploadedAt: -1, _id: -1 });

module.exports = mongoose.model('DocumentVault', documentVaultSchema);
