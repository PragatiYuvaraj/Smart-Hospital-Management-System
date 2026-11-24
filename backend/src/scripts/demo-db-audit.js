// demo-db-audit.js – read‑only audit of the demo database
// ------------------------------------------------------------
// This script uses the backend's DB connection helper (connectDB) which
// automatically loads the environment variables via src/config/env.js.
// It performs only read‑only count/exists queries and never mutates data.

const mongoose = require('mongoose');
const { connectDB } = require('../config/db'); // <-- import helper

// Required models (adjust paths if the project structure changes)
const User = require('../models/User');
const Doctor = require('../models/Doctor');
const Patient = require('../models/Patient');
const DoctorAssignment = require('../models/DoctorAssignment');
const MedicalRecord = require('../models/MedicalRecord');
const Prescription = require('../models/Prescription');
const Medicine = require('../models/Medicine');
const MedicineBatch = require('../models/MedicineBatch');
const StockTransaction = require('../models/StockTransaction');
const ReviewSchedule = require('../models/ReviewSchedule');
const Notification = require('../models/Notification');
const DocumentVault = require('../models/DocumentVault');
// Optional models – load safely; if missing the script will continue.
let Dispensing = null;
let Message = null;
let Conversation = null;
try { Dispensing = require('../models/Dispensing'); } catch (e) { /* optional */ }
try { Message = require('../models/Message'); } catch (e) { /* optional */ }
try { Conversation = require('../models/Conversation'); } catch (e) { /* optional */ }

(async () => {
  try {
    // 1️⃣ Use the backend helper (it loads env.js for us)
    const connected = await connectDB();

    // 2️⃣ Abort early if the helper reports a failure
    if (!connected) {
      console.error('Audit aborted – unable to establish a DB connection.');
      process.exitCode = 1;
      return; // stop before any queries run
    }

    // 3️⃣ Safety guard – only run on the "test" database
    const dbName = mongoose.connection.name; // set after successful connectDB()
    if (dbName !== 'test') {
      console.error(
        `Safety abort – connected to unexpected database "${dbName}". ` +
        'Expected "test". Disconnecting.'
      );
      await mongoose.disconnect();
      process.exitCode = 1;
      return;
    }

    // -----------------------------------------------------------------
    // Read‑only audit queries – count documents in each collection.
    // -----------------------------------------------------------------
    // -----------------------------------------------------------------
    // Read‑only audit queries – basic counts and integrity checks.
    // -----------------------------------------------------------------
    const results = {
      // Basic document counts
      Users: await User.countDocuments(),
      Doctors: await Doctor.countDocuments(),
      Patients: await Patient.countDocuments(),
      DoctorAssignments: await DoctorAssignment.countDocuments(),
      MedicalRecords: await MedicalRecord.countDocuments(),
      Prescriptions: await Prescription.countDocuments(),
      Medicines: await Medicine.countDocuments(),
      MedicineBatches: await MedicineBatch.countDocuments(),
      StockTransactions: await StockTransaction.countDocuments(),
      ReviewSchedules: await ReviewSchedule.countDocuments(),
      Notifications: await Notification.countDocuments(),
      DocumentVaults: await DocumentVault.countDocuments(),

      // 1️⃣ User ↔ Doctor/Patient profile integrity
      OrphanDoctorProfiles: await Doctor.aggregate([
        { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
        { $match: { user: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      OrphanPatientProfiles: await Patient.aggregate([
        { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
        { $match: { user: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      UsersMissingDoctorProfile: await User.aggregate([
        { $match: { role: 'DOCTOR' } },
        { $lookup: { from: 'doctors', localField: '_id', foreignField: 'userId', as: 'doc' } },
        { $match: { doc: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      UsersMissingPatientProfile: await User.aggregate([
        { $match: { role: 'PATIENT' } },
        { $lookup: { from: 'patients', localField: '_id', foreignField: 'userId', as: 'pat' } },
        { $match: { pat: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),

      // 2️⃣ DoctorAssignments integrity
      DoctorAssignmentsMissingDoctor: await DoctorAssignment.aggregate([
        { $lookup: { from: 'doctors', localField: 'doctorId', foreignField: '_id', as: 'doc' } },
        { $match: { doc: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      DoctorAssignmentsMissingPatient: await DoctorAssignment.aggregate([
        { $lookup: { from: 'patients', localField: 'patientId', foreignField: '_id', as: 'pat' } },
        { $match: { pat: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      DuplicateActiveTreatingAssignments: await DoctorAssignment.aggregate([
        { $match: { assignmentType: 'TREATING', status: 'ACTIVE' } },
        { $group: { _id: '$patientId', cnt: { $sum: 1 } } },
        { $match: { cnt: { $gt: 1 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),

      // 3️⃣ MedicalRecords integrity
      MedicalRecordsMissingPatient: await MedicalRecord.aggregate([
        { $lookup: { from: 'patients', localField: 'patientId', foreignField: '_id', as: 'patient' } },
        { $match: { patient: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      MedicalRecordsMissingDoctor: await MedicalRecord.aggregate([
        { $lookup: { from: 'doctors', localField: 'doctorId', foreignField: '_id', as: 'doctor' } },
        { $match: { doctor: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      DraftRecordsMarkedReleased: await MedicalRecord.countDocuments({ status: 'DRAFT', isReleased: true }),
      // When a record is released, both releasedAt and releasedBy should be present
      MedicalRecordsMissingReleaseInfo: await MedicalRecord.aggregate([
        { $match: { isReleased: true, $or: [ { releasedAt: null }, { releasedBy: null } ] } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),

      // 4️⃣ Prescriptions integrity
      PrescriptionsMissingPatient: await Prescription.aggregate([
        { $lookup: { from: 'patients', localField: 'patientId', foreignField: '_id', as: 'patient' } },
        { $match: { patient: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      PrescriptionsMissingDoctor: await Prescription.aggregate([
        { $lookup: { from: 'doctors', localField: 'doctorId', foreignField: '_id', as: 'doctor' } },
        { $match: { doctor: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      PrescriptionsMissingMedicalRecord: await Prescription.aggregate([
        { $lookup: { from: 'medicalrecords', localField: 'medicalRecordId', foreignField: '_id', as: 'mr' } },
        { $match: { mr: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      PrescriptionsOnNonFinalizedRecord: await Prescription.aggregate([
        { $lookup: { from: 'medicalrecords', localField: 'medicalRecordId', foreignField: '_id', as: 'mr' } },
        { $unwind: '$mr' },
        { $match: { 'mr.status': { $ne: 'FINALIZED' } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),

      // 5️⃣ MedicineBatch integrity
      MedicineBatchesMissingMedicine: await MedicineBatch.aggregate([
        { $lookup: { from: 'medicines', localField: 'medicineId', foreignField: '_id', as: 'med' } },
        { $match: { med: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),

      // 6️⃣ StockTransaction integrity
      StockTransactionsMissingMedicine: await StockTransaction.aggregate([
        { $lookup: { from: 'medicines', localField: 'medicineId', foreignField: '_id', as: 'med' } },
        { $match: { med: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      StockTransactionsMissingBatch: await StockTransaction.aggregate([
        { $lookup: { from: 'medicinebatches', localField: 'batchId', foreignField: '_id', as: 'batch' } },
        { $match: { batch: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      StockTransactionsMissingActor: await StockTransaction.aggregate([
        { $lookup: { from: 'users', localField: 'actorId', foreignField: '_id', as: 'actor' } },
        { $match: { actor: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
// Prescription consistency checks for StockTransaction
      StockTransactionsDispensingMissingPrescription: await StockTransaction.aggregate([
        { $match: { transactionType: 'DISPENSING', prescriptionId: null } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      StockTransactionsReceiptHasPrescription: await StockTransaction.aggregate([
        { $match: { transactionType: 'RECEIPT', prescriptionId: { $ne: null } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      StockTransactionsInvalidPrescriptionReference: await StockTransaction.aggregate([
        { $match: { prescriptionId: { $ne: null } } },
        { $lookup: { from: 'prescriptions', localField: 'prescriptionId', foreignField: '_id', as: 'presc' } },
        { $match: { presc: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      StockTxMedicineMismatchBatch: await StockTransaction.aggregate([
        { $lookup: { from: 'medicinebatches', localField: 'batchId', foreignField: '_id', as: 'batch' } },
        { $unwind: '$batch' },
        { $match: { $expr: { $ne: ['$medicineId', '$batch.medicineId'] } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),

      // 7️⃣ ReviewSchedule integrity
      ReviewSchedulesMissingPatient: await ReviewSchedule.aggregate([
        { $lookup: { from: 'patients', localField: 'patientId', foreignField: '_id', as: 'patient' } },
        { $match: { patient: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      ReviewSchedulesMissingDoctor: await ReviewSchedule.aggregate([
        { $lookup: { from: 'doctors', localField: 'doctorId', foreignField: '_id', as: 'doctor' } },
        { $match: { doctor: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),

      // 8️⃣ Notification integrity
      NotificationsMissingRecipient: await Notification.aggregate([
        { $lookup: { from: 'users', localField: 'recipientId', foreignField: '_id', as: 'rec' } },
        { $match: { rec: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      // Notification with a non‑null reviewId but missing the referenced ReviewSchedule
      NotificationsMissingReview: await Notification.aggregate([
        { $match: { reviewId: { $ne: null } } },
        { $lookup: { from: 'reviewschedules', localField: 'reviewId', foreignField: '_id', as: 'rev' } },
        { $match: { rev: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),

      // 9️⃣ Conversation integrity
      ConversationsMissingPatient: await Conversation.aggregate([
        { $lookup: { from: 'patients', localField: 'patientId', foreignField: '_id', as: 'pat' } },
        { $match: { pat: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      ConversationsMissingDoctor: await Conversation.aggregate([
        { $lookup: { from: 'doctors', localField: 'doctorId', foreignField: '_id', as: 'doc' } },
        { $match: { doc: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),

      // 🔟 Message integrity
      MessagesMissingConversation: await Message.aggregate([
        { $lookup: { from: 'conversations', localField: 'conversationId', foreignField: '_id', as: 'conv' } },
        { $match: { conv: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      MessagesMissingSender: await Message.aggregate([
        { $lookup: { from: 'users', localField: 'senderId', foreignField: '_id', as: 'sender' } },
        { $match: { sender: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      MessagesMissingRecipient: await Message.aggregate([
        { $lookup: { from: 'users', localField: 'recipientId', foreignField: '_id', as: 'rec' } },
        { $match: { rec: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      // Message participant consistency – sender and recipient must be the User IDs of the Patient and Doctor linked to the conversation
      MessageParticipantMismatches: await Message.aggregate([
        { $lookup: { from: 'conversations', localField: 'conversationId', foreignField: '_id', as: 'conv' } },
        { $unwind: '$conv' },
        { $lookup: { from: 'patients', localField: 'conv.patientId', foreignField: '_id', as: 'patient' } },
        { $unwind: '$patient' },
        { $lookup: { from: 'doctors', localField: 'conv.doctorId', foreignField: '_id', as: 'doctor' } },
        { $unwind: '$doctor' },
        {
          $match: {
            $expr: {
              $not: [
                {
                  $or: [
                    { $and: [ { $eq: ['$senderId', '$patient.userId'] }, { $eq: ['$recipientId', '$doctor.userId'] } ] },
                    { $and: [ { $eq: ['$senderId', '$doctor.userId'] }, { $eq: ['$recipientId', '$patient.userId'] } ] }
                  ]
                }
              ]
            }
          }
        },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),

      // 📂 DocumentVault integrity (already counted above)
      DocumentVaultsMissingDoctor: await DocumentVault.aggregate([
        { $lookup: { from: 'doctors', localField: 'ownerDoctorId', foreignField: '_id', as: 'doc' } },
        { $match: { doc: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0)),
      DocumentVaultsMissingUploader: await DocumentVault.aggregate([
        { $lookup: { from: 'users', localField: 'uploadedBy', foreignField: '_id', as: 'user' } },
        { $match: { user: { $size: 0 } } },
        { $count: 'cnt' }
      ]).then(r => (r[0] ? r[0].cnt : 0))
    };
    // Optional collections – include if the model was loaded successfully.
    if (Dispensing) results.Dispensings = await Dispensing.countDocuments();
    if (Message) results.Messages = await Message.countDocuments();
    if (Conversation) results.Conversations = await Conversation.countDocuments();

    console.log('\n=== Demo DB Audit Summary ===');
    console.table(results);

  } catch (err) {
    // Sanitised error handling – no credentials or raw stack printed.
    process.exitCode = 1;
    const safeMsg = err.name ? err.name : 'AuditError';
    console.error(`Audit failed – ${safeMsg}`);
  } finally {
    // Ensure the Mongoose connection is closed.
    if (mongoose.connection.readyState) {
      await mongoose.disconnect();
    }
  }
})();
