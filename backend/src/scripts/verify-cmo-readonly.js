// verify-cmo-readonly.js – read‑only CMO verification script
// ------------------------------------------------------------
// This script uses the existing backend configuration and models to
// query for DOCTOR users that have the MANAGE_USERS permission and
// reports whether each has an associated Doctor profile. It also
// checks for a specific "Dr. Gregory House" account.
//
// Usage (run from repository root):
//   node backend/src/scripts/verify-cmo-readonly.js
//
// No data is mutated – all operations are read‑only.

const path = require('path');
const dotenv = require('dotenv');
// Load root .env (the same path used by the backend)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Re‑use the existing env configuration (provides MONGODB_URI, etc.)
const env = require('../config/env');
const { connectDB } = require('../config/db');

// Load Mongoose models (paths are relative to this script)
const User = require('../models/User');
const Doctor = require('../models/Doctor');

(async () => {
  try {
    // Connect to MongoDB (read‑only)
    const dbConnected = await connectDB();
    if (!dbConnected) {
      console.error('Unable to establish MongoDB connection – aborting verification.');
      process.exit(1);
    }

    // Helper to format a user record
    const formatUser = async (user) => {
      const hasDoctorProfile = await Doctor.exists({ userId: user._id });
      const hasDutyDoctor = user.permissions.includes('DUTY_DOCTOR');
      const hasVaultAccess = user.permissions.includes('VAULT_ACCESS');
      return {
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        permissions: user.permissions,
        hasDutyDoctor,
        hasVaultAccess,
        hasDoctorProfile: !!hasDoctorProfile,
      };
    };

    // 1️⃣ Find all DOCTOR users with MANAGE_USERS permission
    const doctorAdmins = await User.find({
      role: 'DOCTOR',
      permissions: { $elemMatch: { $eq: 'MANAGE_USERS' } },
    });

    const results = [];
    for (const user of doctorAdmins) {
      results.push(await formatUser(user));
    }

    // 2️⃣ Also look for a user named "Dr. Gregory House" (case‑insensitive)
    const houseUser = await User.findOne({
      name: { $regex: /^dr\.\s*gregory\s+house$/i },
    });
    if (houseUser) {
      // Avoid duplicate entry if already in results
      const already = results.find((r) => r.email === houseUser.email);
      if (!already) {
        results.push(await formatUser(houseUser));
      }
    }

    // Output concise report (JSON for easy readability)
    console.log('\n=== CMO Verification Report ===');
    if (results.length === 0) {
      console.log('No DOCTOR users with MANAGE_USERS permission found.');
    } else {
      results.forEach((r) => {
        console.log('\n---');
        console.log(`Name           : ${r.name}`);
        console.log(`Email          : ${r.email}`);
        console.log(`Role           : ${r.role}`);
        console.log(`Status         : ${r.status}`);
        console.log(`Permissions    : ${r.permissions.join(', ')}`);
        console.log(`Has DUTY_DOCTOR: ${r.hasDutyDoctor}`);
        console.log(`Has VAULT_ACCESS: ${r.hasVaultAccess}`);
        console.log(`Doctor profile : ${r.hasDoctorProfile ? 'exists' : 'missing'}`);
      });
    }
  } catch (err) {
    // Sanitized error output – do not leak connection strings
    console.error('Error during verification:', err.message);
  } finally {
    // Gracefully close the Mongoose connection if it was opened
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
})();
