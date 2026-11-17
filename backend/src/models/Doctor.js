'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');

const doctorSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User account is required'],
      unique: true
    },
    doctorNumber: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      default: () => `DOC-${crypto.randomBytes(8).toString('hex').toUpperCase()}`
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters']
    },
    specialization: {
      type: String,
      required: [true, 'Specialization is required'],
      trim: true,
      maxlength: [100, 'Specialization cannot exceed 100 characters']
    },
    registrationReference: {
      type: String,
      required: [true, 'Registration reference is required'],
      trim: true,
      maxlength: [100, 'Registration reference cannot exceed 100 characters']
    },
    department: {
      type: String,
      required: [true, 'Department is required'],
      trim: true,
      maxlength: [100, 'Department cannot exceed 100 characters']
    },
    status: {
      type: String,
      enum: {
        values: ['ACTIVE', 'INACTIVE'],
        message: 'Status must be ACTIVE or INACTIVE'
      },
      default: 'ACTIVE',
      required: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Doctor', doctorSchema);
