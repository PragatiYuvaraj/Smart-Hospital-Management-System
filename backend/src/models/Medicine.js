'use strict';

const mongoose = require('mongoose');

const medicineSchema = new mongoose.Schema(
  {
    identifier: {
      type: String,
      required: [true, 'Medicine identifier is required'],
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: [40, 'Medicine identifier cannot exceed 40 characters']
    },
    name: {
      type: String,
      required: [true, 'Medicine name is required'],
      trim: true,
      maxlength: [150, 'Medicine name cannot exceed 150 characters']
    },
    genericName: {
      type: String,
      trim: true,
      maxlength: [150, 'Generic name cannot exceed 150 characters']
    },
    strength: {
      type: String,
      trim: true,
      maxlength: [50, 'Strength cannot exceed 50 characters']
    },
    form: {
      type: String,
      required: [true, 'Medicine form is required'],
      trim: true,
      maxlength: [50, 'Medicine form cannot exceed 50 characters']
    },
    category: {
      type: String,
      required: [true, 'Medicine category is required'],
      trim: true,
      maxlength: [80, 'Medicine category cannot exceed 80 characters']
    },
    manufacturer: {
      type: String,
      trim: true,
      maxlength: [150, 'Manufacturer cannot exceed 150 characters']
    },
    reorderLevel: {
      type: Number,
      default: 0,
      min: [0, 'Reorder level cannot be negative'],
      validate: {
        validator: Number.isSafeInteger,
        message: 'Reorder level must be a whole number'
      }
    },
    active: {
      type: Boolean,
      default: true,
      required: true
    }
  },
  { timestamps: true }
);

medicineSchema.index({ name: 1 });
medicineSchema.index({ genericName: 1 });

module.exports = mongoose.model('Medicine', medicineSchema);
