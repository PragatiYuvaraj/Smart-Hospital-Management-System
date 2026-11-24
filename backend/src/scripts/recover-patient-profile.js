/**
 * recover-patient-profile.js — One-time CLI Patient Profile Recovery
 *
 * PURPOSE:
 *   Recovers/creates a missing Patient profile document for an existing User account
 *   (e.g., created prior to Milestone 4 profile requirements).
 *
 * SAFETY RULES:
 *   - CLI only. Never exposed via HTTP.
 *   - Runs in DRY-RUN mode by default.
 *   - Requires explicit `--confirm` flag to execute write operations.
 *   - Verifies target user exists, is ACTIVE, and has role PATIENT.
 *   - Refuses to create duplicate Patient profile if one already exists.
 *   - Attributes audit action to CMO user with MANAGE_USERS (never falsely to patient).
 *   - Uses transactions where supported by the replica set.
 *   - Preserves User credentials, passwords, and tokens untouched.
 *   - Does not expose secrets or connection strings in logs.
 *
 * USAGE:
 *   Dry-run (default):
 *     node src/scripts/recover-patient-profile.js --userId=6afa9a47a83d1f4b36533f12 --dob=1995-05-15
 *
 *   Actual execution:
 *     node src/scripts/recover-patient-profile.js --userId=6afa9a47a83d1f4b36533f12 --dob=1995-05-15 --confirm
 */

'use strict';

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const mongoose = require('mongoose');
const User = require('../models/User');
const Patient = require('../models/Patient');
const { recordAudit } = require('../services/audit.service');

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed = {
    confirm: false,
    userId: null,
    dob: null,
    contactNumber: null,
    address: null
  };

  for (const arg of args) {
    if (arg === '--confirm') {
      parsed.confirm = true;
    } else if (arg.startsWith('--userId=')) {
      parsed.userId = arg.split('=')[1].trim();
    } else if (arg.startsWith('--dob=')) {
      parsed.dob = arg.split('=')[1].trim();
    } else if (arg.startsWith('--contact=')) {
      parsed.contactNumber = arg.split('=')[1].trim();
    } else if (arg.startsWith('--address=')) {
      parsed.address = arg.split('=')[1].trim();
    }
  }

  return parsed;
};

const supportsTransactions = () => {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.client) {
    return false;
  }
  const topology = mongoose.connection.client.topology;
  const topologyType = topology && topology.description && topology.description.type;
  return ['ReplicaSetWithPrimary', 'ReplicaSetNoPrimary', 'Sharded'].includes(topologyType);
};

async function recoverPatientProfile() {
  const { confirm, userId, dob, contactNumber, address } = parseArgs();

  console.log('\n============================================================');
  console.log('   Smart Hospital — Patient Profile Recovery Utility        ');
  console.log('============================================================\n');

  if (!userId) {
    console.error('[Error] Missing required argument: --userId=<targetUserId>');
    process.exit(1);
  }

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    console.error(`[Error] Provided userId '${userId}' is not a valid MongoDB ObjectId.`);
    process.exit(1);
  }

  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    console.error('[Error] Missing required argument: --dob=YYYY-MM-DD');
    process.exit(1);
  }

  const dateOfBirth = new Date(`${dob}T00:00:00.000Z`);
  if (
    Number.isNaN(dateOfBirth.getTime()) ||
    dateOfBirth.toISOString().slice(0, 10) !== dob ||
    dateOfBirth > new Date()
  ) {
    console.error('[Error] Invalid date of birth provided. Must be YYYY-MM-DD and cannot be in the future.');
    process.exit(1);
  }

  const mode = confirm ? '*** LIVE WRITE MODE (--confirm specified) ***' : 'DRY-RUN MODE (No changes will be written)';
  console.log(`Execution Mode: ${mode}`);
  console.log(`Target User ID: ${userId}`);
  console.log(`Date of Birth : ${dateOfBirth.toISOString().slice(0, 10)}`);
  if (contactNumber) console.log(`Contact Number: ${contactNumber}`);
  if (address)       console.log(`Address       : ${address}`);
  console.log('------------------------------------------------------------\n');

  console.log('[Recovery] Connecting to database...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('[Recovery] Connected successfully.\n');

  // 1. Verify target user
  const user = await User.findById(userId);
  if (!user) {
    console.error(`[Recovery] ERROR: User with ID ${userId} does not exist.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  if (user.role !== 'PATIENT') {
    console.error(`[Recovery] ERROR: User account has role '${user.role}'. Must be 'PATIENT'.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  if (user.status !== 'ACTIVE') {
    console.error(`[Recovery] ERROR: User account status is '${user.status}'. Must be 'ACTIVE'.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`[Recovery] Verified User: ${user.name} (${user.email}) | Role: ${user.role} | Status: ${user.status}`);

  // 2. Guard against duplicate profile
  const existingPatient = await Patient.findOne({ userId });
  if (existingPatient) {
    console.error(`[Recovery] ABORTED: Patient profile already exists for this user:`);
    console.error(`  Patient Profile ID : ${existingPatient._id}`);
    console.error(`  Patient Number     : ${existingPatient.patientNumber}`);
    console.error(`  Status             : ${existingPatient.status}`);
    await mongoose.disconnect();
    process.exit(0);
  }

  // 3. Locate CMO actor for audit attribution
  const cmoUser = await User.findOne({ permissions: 'MANAGE_USERS', status: 'ACTIVE' });
  if (!cmoUser) {
    console.error('[Recovery] ERROR: No active CMO user with MANAGE_USERS found to attribute audit log.');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`[Recovery] Audit Actor: ${cmoUser.name} (${cmoUser.email}) [MANAGE_USERS]`);

  // 4. Construct Patient document with schema validation
  const patient = new Patient({
    userId: user._id,
    name: user.name,
    dateOfBirth,
    ...(contactNumber ? { contactNumber } : {}),
    ...(address ? { address } : {}),
    status: 'ACTIVE'
  });

  // Validate without saving
  await patient.validate();
  console.log(`[Recovery] Generated Patient Number: ${patient.patientNumber}`);
  console.log('[Recovery] Schema validation passed successfully.');

  if (!confirm) {
    console.log('\n[DRY-RUN COMPLETE] All pre-conditions and schema validations passed.');
    console.log('No data was written to the database.');
    console.log('To execute the recovery, run the command again with `--confirm`.\n');
    await mongoose.disconnect();
    process.exit(0);
  }

  // 5. Execute Live Write (with transaction if replica set supported)
  console.log('\n[Recovery] Executing live recovery...');
  if (supportsTransactions()) {
    console.log('[Recovery] Using replica set transaction...');
    await mongoose.connection.transaction(async (session) => {
      await patient.save({ session });
      await recordAudit(
        {
          actorId: cmoUser._id,
          actorType: 'USER',
          action: 'PATIENT_PROFILE_RECOVERED',
          resourceType: 'Patient',
          resourceId: patient._id,
          accessType: 'MANAGEMENT'
        },
        session
      );
    });
  } else {
    console.log('[Recovery] Using direct save with safe error handling...');
    await patient.save();
    try {
      await recordAudit({
        actorId: cmoUser._id,
        actorType: 'USER',
        action: 'PATIENT_PROFILE_RECOVERED',
        resourceType: 'Patient',
        resourceId: patient._id,
        accessType: 'MANAGEMENT'
      });
    } catch (auditError) {
      console.error('[Recovery] Audit logging failed; rolling back patient profile creation...');
      await Patient.deleteOne({ _id: patient._id });
      throw auditError;
    }
  }

  console.log('\n============================================================');
  console.log('          Patient Profile Recovered Successfully!           ');
  console.log('============================================================');
  console.log(`  Patient Profile ID : ${patient._id}`);
  console.log(`  Patient Number     : ${patient.patientNumber}`);
  console.log(`  Linked User ID     : ${patient.userId}`);
  console.log(`  Name               : ${patient.name}`);
  console.log(`  Date of Birth      : ${patient.dateOfBirth.toISOString().slice(0, 10)}`);
  console.log(`  Status             : ${patient.status}`);
  console.log(`  Audit Event Logged : PATIENT_PROFILE_RECOVERED (Actor: CMO)`);
  console.log('============================================================\n');

  await mongoose.disconnect();
  console.log('[Recovery] MongoDB disconnected.\n');
  process.exit(0);
}

recoverPatientProfile().catch((err) => {
  console.error('\n[Recovery Error] Execution failed:', err.message || err);
  mongoose.disconnect().finally(() => process.exit(1));
});
