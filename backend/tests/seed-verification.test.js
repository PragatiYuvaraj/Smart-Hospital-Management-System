'use strict';

const mongoose = require('mongoose');
const { execSync } = require('child_process');
const { getDedicatedTestDatabaseUri } = require('./test-database-guard');
const testUri = getDedicatedTestDatabaseUri({ required: true });

const Medicine = require('../src/models/Medicine');
const MedicineBatch = require('../src/models/MedicineBatch');
const StockTransaction = require('../src/models/StockTransaction');
const User = require('../src/models/User');

const medIds = [
    'MED-AMX-500', 'MED-PCM-500', 'MED-IBU-400', 'MED-MET-500', 'MED-OMP-020', 'MED-ATR-010'
];

async function runSeed() {
    // Run the seed script with test DB URI passed via env
    execSync('node src/scripts/seed-medicines.js', {
        stdio: 'inherit',
        env: { ...process.env, MONGODB_URI: testUri }
    });
}

async function connectDb() {
    await mongoose.connect(testUri, { serverSelectionTimeoutMS: 5000 });
}

async function disconnectDb() {
    await mongoose.disconnect();
}

(async () => {
    let pharmacyUser;
    let exitCode = 0;
    try {
        await connectDb();
        pharmacyUser = await User.findOne({ email: 'pharmacy@smarthospital.local' });
        if (!pharmacyUser) {
            throw new Error('Pharmacy demo user missing in the dedicated test database.');
        } else {
            // First run – should create all entities.
            await runSeed();
            const medCount1 = await Medicine.countDocuments({ identifier: { $in: medIds } });
            const batchCount1 = await MedicineBatch.countDocuments({ batchNumber: { $regex: '^INIT-' } });
            const txCount1 = await StockTransaction.countDocuments({ transactionType: 'RECEIPT', actorId: pharmacyUser._id });

            // Second run – counts must stay the same.
            await runSeed();
            const medCount2 = await Medicine.countDocuments({ identifier: { $in: medIds } });
            const batchCount2 = await MedicineBatch.countDocuments({ batchNumber: { $regex: '^INIT-' } });
            const txCount2 = await StockTransaction.countDocuments({ transactionType: 'RECEIPT', actorId: pharmacyUser._id });

            const pass = (medCount1 === 6 && batchCount1 === 6 && txCount1 === 6 &&
                medCount2 === medCount1 && batchCount2 === batchCount1 && txCount2 === txCount1);
            if (pass) {
                console.log('PASS: Medicine seed is idempotent – counts unchanged after second run.');
            } else {
                throw new Error('Medicine seed idempotency check failed.');
            }
        }
    } catch (e) {
        console.error('ERROR during seed verification test:', e.message || e);
        exitCode = 1;
    } finally {
        try {
            if (pharmacyUser) {
                const medicineIds = await Medicine.find({ identifier: { $in: medIds } }).distinct('_id');
                await StockTransaction.deleteMany({ transactionType: 'RECEIPT', actorId: pharmacyUser._id, medicineId: { $in: medicineIds } });
                await MedicineBatch.deleteMany({ batchNumber: { $in: medIds.map(id => `INIT-${id}`) } });
                await Medicine.deleteMany({ identifier: { $in: medIds } });
            }
        } catch (cleanupError) {
            console.error('ERROR cleaning up seed verification data:', cleanupError.message || cleanupError);
            exitCode = 1;
        }
        try {
            await disconnectDb();
        } catch (disconnectError) {
            console.error('ERROR disconnecting from dedicated test database:', disconnectError.message || disconnectError);
            exitCode = 1;
        }
    }
    process.exitCode = exitCode;
})();
