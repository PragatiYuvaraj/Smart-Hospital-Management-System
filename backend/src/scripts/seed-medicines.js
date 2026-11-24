// Seed script for synthetic medicine catalogue (idempotent)
'use strict';

const mongoose = require('mongoose');
const env = require('../config/env');
const Medicine = require('../models/Medicine');
const MedicineBatch = require('../models/MedicineBatch');
const StockTransaction = require('../models/StockTransaction');
const User = require('../models/User');

// Define the six medicines to seed
const medicinesToSeed = [
  {
    identifier: 'MED-AMX-500',
    name: 'Amoxicillin 500mg',
    genericName: 'Amoxicillin',
    strength: '500 mg',
    form: 'Capsule',
    category: 'Antibiotic',
    manufacturer: 'PharmaCo',
    reorderLevel: 20,
    active: true,
  },
  {
    identifier: 'MED-PCM-500',
    name: 'Paracetamol 500mg',
    genericName: 'Paracetamol',
    strength: '500 mg',
    form: 'Tablet',
    category: 'Analgesic',
    manufacturer: 'HealthCorp',
    reorderLevel: 30,
    active: true,
  },
  {
    identifier: 'MED-IBU-400',
    name: 'Ibuprofen 400mg',
    genericName: 'Ibuprofen',
    strength: '400 mg',
    form: 'Tablet',
    category: 'NSAID',
    manufacturer: 'MediLife',
    reorderLevel: 25,
    active: true,
  },
  {
    identifier: 'MED-MET-500',
    name: 'Metformin 500mg',
    genericName: 'Metformin',
    strength: '500 mg',
    form: 'Tablet',
    category: 'Antidiabetic',
    manufacturer: 'GlucoseInc',
    reorderLevel: 15,
    active: true,
  },
  {
    identifier: 'MED-OMP-020',
    name: 'Omeprazole 20mg',
    genericName: 'Omeprazole',
    strength: '20 mg',
    form: 'Capsule',
    category: 'Gastro',
    manufacturer: 'DigestivePharma',
    reorderLevel: 10,
    active: true,
  },
  {
    identifier: 'MED-ATR-010',
    name: 'Atorvastatin 10mg',
    genericName: 'Atorvastatin',
    strength: '10 mg',
    form: 'Tablet',
    category: 'Cardio',
    manufacturer: 'HeartWell',
    reorderLevel: 12,
    active: true,
  },
];

// Helper to get future expiry (1 year from now)
function futureExpiryDate() {
  const now = new Date();
  now.setFullYear(now.getFullYear() + 1);
  return now;
}

async function seedMedicines() {
  try {
    console.log('[SeedMedicines] Connecting to MongoDB...');
    await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    console.log('[SeedMedicines] Connected.');

    // Resolve pharmacy user to act as transaction actor
    const pharmacyUser = await User.findOne({ email: 'pharmacy@smarthospital.local' });
    if (!pharmacyUser) {
      console.error('[SeedMedicines] ERROR: Pharmacy demo user not found. Seed demo accounts first.');
      process.exit(1);
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const med of medicinesToSeed) {
          // Upsert medicine (idempotent)
          let medicine = await Medicine.findOne({ identifier: med.identifier }).session(session);
          if (!medicine) {
            medicine = new Medicine(med);
            await medicine.save({ session });
            console.log(`[SeedMedicines] Created medicine ${med.identifier}`);
          } else {
            console.log(`[SeedMedicines] Medicine ${med.identifier} already exists`);
          }

          // Create a single initial batch per medicine
          const batchNumber = `INIT-${med.identifier}`;
          let batch = await MedicineBatch.findOne({ medicineId: medicine._id, batchNumber }).session(session);
          if (!batch) {
            batch = new MedicineBatch({
              medicineId: medicine._id,
              batchNumber,
              expiryDate: futureExpiryDate(),
              receivedQuantity: 100,
              availableQuantity: 100,
              supplierReference: 'SEED-INIT',
            });
            await batch.save({ session });
            console.log(`[SeedMedicines] Created batch ${batchNumber}`);
          } else {
            console.log(`[SeedMedicines] Batch ${batchNumber} already exists`);
          }

          // Ensure a single RECEIPT transaction exists for this batch
          const existingTx = await StockTransaction.findOne({
            medicineId: medicine._id,
            batchId: batch._id,
            transactionType: 'RECEIPT',
            actorId: pharmacyUser._id,
          }).session(session);
          if (!existingTx) {
            const tx = new StockTransaction({
              medicineId: medicine._id,
              batchId: batch._id,
              transactionType: 'RECEIPT',
              quantity: batch.receivedQuantity,
              actorId: pharmacyUser._id,
            });
            await tx.save({ session });
            console.log(`[SeedMedicines] Created RECEIPT transaction for batch ${batchNumber}`);
          } else {
            console.log(`[SeedMedicines] RECEIPT transaction for batch ${batchNumber} already exists`);
          }
        }
      });
    } catch (txErr) {
      console.error('[SeedMedicines] Transaction failed – partial data may have been written.', txErr);
      throw txErr;
    } finally {
      await session.endSession();
    }

    await mongoose.connection.close();
    console.log('[SeedMedicines] Completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('[SeedMedicines] ERROR:', err);
    if (mongoose.connection.readyState !== 0) await mongoose.connection.close();
    process.exit(1);
  }
}

seedMedicines();
