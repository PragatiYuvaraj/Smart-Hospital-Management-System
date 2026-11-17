'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');

const patientSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User account is required'],
      unique: true
    },
    patientNumber: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      default: () => `PAT-${crypto.randomBytes(8).toString('hex').toUpperCase()}`
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters']
    },
    dateOfBirth: {
      type: Date,
      required: [true, 'Date of birth is required'],
      validate: {
        validator: (date) => date <= new Date(),
        message: 'Date of birth cannot be in the future'
      }
    },
    contactNumber: {
      type: String,
      trim: true,
      maxlength: [30, 'Contact number cannot exceed 30 characters']
    },
    address: {
      type: String,
      trim: true,
      maxlength: [500, 'Address cannot exceed 500 characters']
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

module.exports = mongoose.model('Patient', patientSchema);
