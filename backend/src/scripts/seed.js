const mongoose = require('mongoose');
const env = require('../config/env');
const User = require('../models/User');

const demoAccounts = [
  {
    name: 'Dr. Sarah Jenkins',
    email: 'doctor@smarthospital.local',
    password: 'Doctor@123',
    role: 'DOCTOR',
    permissions: ['DUTY_DOCTOR', 'VAULT_ACCESS'],
    status: 'ACTIVE'
  },
  {
    name: 'Alex Rivera (Pharmacy Staff)',
    email: 'pharmacy@smarthospital.local',
    password: 'Pharmacy@123',
    role: 'PHARMACY',
    permissions: [],
    status: 'ACTIVE'
  },
  {
    name: 'John Doe (Patient)',
    email: 'patient@smarthospital.local',
    password: 'Patient@123',
    role: 'PATIENT',
    permissions: [],
    status: 'ACTIVE'
  }
];

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
      if (existing) {
        console.log(`[Seed] Notice: ${account.role} account (${account.email}) already exists. Preserving password.`);
      } else {
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
    }

    console.log('\n[Seed] Demonstration Credentials:');
    console.log('------------------------------------------------------------');
    console.log('DOCTOR:   Email: doctor@smarthospital.local   | Password: Doctor@123');
    console.log('PHARMACY: Email: pharmacy@smarthospital.local | Password: Pharmacy@123');
    console.log('PATIENT:  Email: patient@smarthospital.local  | Password: Patient@123');
    console.log('------------------------------------------------------------');
    console.log('[Seed] Demonstration seeding complete.\n');

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

seedDemoAccounts();
