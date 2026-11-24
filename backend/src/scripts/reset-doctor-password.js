/**
 * reset-doctor-password.js — Secure Interactive CLI Password Reset Utility
 *
 * PURPOSE:
 *   Resets password for an existing active DOCTOR account via hidden
 *   interactive terminal prompt (never accepting password as a CLI argument).
 *
 * SAFETY RULES:
 *   - Runs in DRY-RUN mode by default.
 *   - Requires explicit `--confirm` flag to execute write operations.
 *   - Rejects targets that are not active DOCTOR accounts.
 *   - Prompts for password interactively with masked/hidden input (no CLI args).
 *   - Preserves User ID, email, role, status, permissions, and doctor profile.
 *   - Emits audit log attributed to CMO administrator with MANAGE_USERS.
 *   - Never exposes password, hash, token, or connection strings in logs.
 *
 * USAGE:
 *   Dry-run (default):
 *     node src/scripts/reset-doctor-password.js --userId=6b0024bd2d060ad30bc0c524
 *
 *   Execute:
 *     node src/scripts/reset-doctor-password.js --userId=6b0024bd2d060ad30bc0c524 --confirm
 */

'use strict';

const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const mongoose = require('mongoose');
const User = require('../models/User');
const { recordAudit } = require('../services/audit.service');

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed = {
    confirm: false,
    userId: null
  };

  for (const arg of args) {
    if (arg === '--confirm') {
      parsed.confirm = true;
    } else if (arg.startsWith('--userId=')) {
      parsed.userId = arg.split('=')[1].trim();
    } else if (arg.startsWith('--password=')) {
      console.error('\n[Security Error] Passwords must NOT be supplied as CLI arguments.');
      console.error('Use the secure interactive prompt instead.\n');
      process.exit(1);
    }
  }

  return parsed;
};

/**
 * Prompts user for password on terminal while masking input.
 */
const promptHiddenPassword = (promptText = 'Enter new password: ') => {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    });

    // Write prompt text
    process.stdout.write(promptText);

    let password = '';
    const onData = (char) => {
      char = char.toString();
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004':
          process.stdin.removeListener('data', onData);
          break;
        case '\u0003': // Ctrl+C
          process.exit(1);
          break;
        case '\u007f': // Backspace
        case '\b':
          if (password.length > 0) {
            password = password.slice(0, -1);
          }
          break;
        default:
          password += char;
          break;
      }
    };

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', onData);
    }

    rl.question('', () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      rl.close();
      console.log(''); // newline after enter
      resolve(password);
    });
  });
};

async function resetPassword() {
  const { confirm, userId } = parseArgs();

  console.log('\n============================================================');
  console.log('     Smart Hospital — Secure Password Reset Utility         ');
  console.log('============================================================\n');

  if (!userId) {
    console.error('[Error] Missing required argument: --userId=<targetUserId>');
    process.exit(1);
  }

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    console.error(`[Error] Provided userId '${userId}' is not a valid MongoDB ObjectId.`);
    process.exit(1);
  }

  const mode = confirm ? '*** LIVE WRITE MODE (--confirm specified) ***' : 'DRY-RUN MODE (No changes will be written)';
  console.log(`Execution Mode: ${mode}`);
  console.log(`Target User ID: ${userId}`);
  console.log('------------------------------------------------------------\n');

  console.log('[Reset] Connecting to database...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('[Reset] Connected successfully.\n');

  // Verify target user
  const user = await User.findById(userId);
  if (!user) {
    console.error(`[Reset] ERROR: User with ID ${userId} does not exist.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  if (user.role !== 'DOCTOR') {
    console.error(`[Reset] ERROR: User account has role '${user.role}'. Must be 'DOCTOR'.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  if (user.status !== 'ACTIVE') {
    console.error(`[Reset] ERROR: User account status is '${user.status}'. Must be ACTIVE.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`[Reset] Target User Verified: ${user.name} (${user.email}) | Role: ${user.role} | Status: ${user.status}`);

  // Discover active CMO admin for audit attribution
  const cmoUser = await User.findOne({ permissions: 'MANAGE_USERS', status: 'ACTIVE' });
  if (!cmoUser) {
    console.error('[Reset] ERROR: No active CMO user with MANAGE_USERS found to attribute audit log.');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`[Reset] Audit Actor: ${cmoUser.name} (${cmoUser.email}) [MANAGE_USERS]`);

  if (!confirm) {
    console.log('\n[DRY-RUN COMPLETE] Pre-conditions verified. No password prompt requested.');
    console.log('To execute the reset with interactive prompt, run with `--confirm`.\n');
    await mongoose.disconnect();
    process.exit(0);
  }

  // Interactive password prompt
  const password = await promptHiddenPassword('Enter new password (min 8 chars): ');

  if (!password || password.length < 8) {
    console.error('\n[Error] Password must be at least 8 characters long.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const confirmPassword = await promptHiddenPassword('Confirm new password: ');
  if (password !== confirmPassword) {
    console.error('\n[Error] Passwords do not match.');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('\n[Reset] Updating password...');
  user.passwordHash = password; // Trigger pre-save hook to hash with bcrypt
  await user.save();

  await recordAudit({
    actorId: cmoUser._id,
    actorType: 'USER',
    action: 'PASSWORD_RESET',
    resourceType: 'User',
    resourceId: user._id,
    accessType: 'MANAGEMENT'
  });

  console.log('\n============================================================');
  console.log('            Password Reset Successfully!                    ');
  console.log('============================================================');
  console.log(`  User ID            : ${user._id}`);
  console.log(`  Name               : ${user.name}`);
  console.log(`  Email              : ${user.email}`);
  console.log(`  Role               : ${user.role}`);
  console.log(`  Audit Event Logged : PASSWORD_RESET (Actor: CMO)`);
  console.log('============================================================\n');

  await mongoose.disconnect();
  console.log('[Reset] MongoDB disconnected.\n');
  process.exit(0);
}

resetPassword().catch((err) => {
  console.error('\n[Reset Error] Execution failed:', err.message || err);
  mongoose.disconnect().finally(() => process.exit(1));
});
