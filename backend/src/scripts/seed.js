const mongoose = require('mongoose');
const dotenv = require('dotenv');
// Load environment variables from backend/.env (same directory as env.js)
dotenv.config({ path: require('path').resolve(__dirname, '../../.env') });

const env = require('../config/env');
const User = require('../models/User');

const demoAccounts = [
  {
    name: 'Dr. Sarah Jenkins',
    email: 'doctor@smarthospital.local',
    password: process.env.DEMO_DOCTOR_PASSWORD,
    role: 'DOCTOR',
    permissions: ['DUTY_DOCTOR', 'VAULT_ACCESS'],
    status: 'ACTIVE'
  },
  {
    name: 'Alex Rivera (Pharmacy Staff)',
    email: 'pharmacy@smarthospital.local',
    password: process.env.DEMO_PHARMACY_PASSWORD,
    role: 'PHARMACY',
    permissions: [],
    status: 'ACTIVE'
  },
  {
    name: 'John Doe (Patient)',
    email: 'patient@smarthospital.local',
    password: process.env.DEMO_PATIENT_PASSWORD,
    role: 'PATIENT',
    permissions: [],
    status: 'ACTIVE'
  }
];

const handleExistingAccount = (account, existing, logger = console) => {
  if (!existing) return false;
  logger.log(`[Seed] Notice: ${account.role} account (${account.email}) already exists. Preserving password.`);
  return true;
};

const seedDemoAccounts = async () => {
  try {
    console.log('[Seed] Connecting to MongoDB...');
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000
    });
    console.log('[Seed] Connected to database.');

    console.log('[Seed] Seeding demonstration accounts (idempotent check)...');

    for (const account of demoAccounts) {
      const existing = await User.findOne({ email: account.email });
      if (handleExistingAccount(account, existing)) continue;

      const newUser = new User({
        name: account.name,
        email: account.email,
        passwordHash: account.password, // Automatically hashed by User pre-save hook
        role: account.role,
        permissions: account.permissions,
        status: account.status
      });
      await newUser.save();
      console.log(`[Seed] Success: Created demo ${account.role} account -> ${account.email}`);
    }

    // Removed credential logging for CI safety

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('[Seed Error] Failed to seed demonstration accounts:', error.message);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
};

if (require.main === module) {
  const missing = [];
  if (!process.env.DEMO_DOCTOR_PASSWORD) missing.push('DEMO_DOCTOR_PASSWORD');
  if (!process.env.DEMO_PHARMACY_PASSWORD) missing.push('DEMO_PHARMACY_PASSWORD');
  if (!process.env.DEMO_PATIENT_PASSWORD) missing.push('DEMO_PATIENT_PASSWORD');
  if (missing.length) {
    console.error('[Seed Error] Missing required environment variable(s):');
    missing.forEach(v => console.error(`  • ${v}`));
    process.exit(1);
  }

  seedDemoAccounts();
}

module.exports = { handleExistingAccount };
