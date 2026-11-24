'use strict';

const { getDedicatedTestDatabaseUri } = require('./test-database-guard');
const testDatabaseUri = getDedicatedTestDatabaseUri({ required: true });

const http = require('http');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const env = require('../src/config/env');
const app = require('../src/app');
const generateToken = require('../src/utils/generateToken');

const User = require('../src/models/User');
const Patient = require('../src/models/Patient');
const Doctor = require('../src/models/Doctor');
const DoctorAssignment = require('../src/models/DoctorAssignment');
const Conversation = require('../src/models/Conversation');
const Message = require('../src/models/Message');
const DocumentVault = require('../src/models/DocumentVault');
const AuditLog = require('../src/models/AuditLog');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runLiveIntegrationVerification() {
  console.log('============================================================');
  console.log('   MILESTONE 6: REAL MONGODB & API INTEGRATION TEST SUITE');
  console.log('============================================================\n');

  // 1. Connect only to the explicitly configured dedicated test database.
  console.log('[Setup] Connecting to the dedicated test database...');
  await mongoose.connect(testDatabaseUri, { serverSelectionTimeoutMS: 10000 });
  const topology = mongoose.connection.client?.topology?.description?.type;
  console.log(`[Setup] Connected to MongoDB Atlas! Topology: ${topology}`);
  if (!['ReplicaSetWithPrimary', 'ReplicaSetNoPrimary', 'Sharded'].includes(topology)) {
    throw new Error(`Transactions unsupported on topology ${topology}`);
  }

  // 2. Start HTTP server
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[Setup] Express test server listening at ${baseUrl}\n`);

  function apiRequest(method, path, { token, body, headers = {}, isMultipart = false } = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const reqHeaders = { ...headers };
      if (token) reqHeaders['Authorization'] = `Bearer ${token}`;
      if (body && !isMultipart && !reqHeaders['Content-Type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }

      const req = http.request(url, { method, headers: reqHeaders }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          let parsed;
          try {
            parsed = JSON.parse(buffer.toString('utf8'));
          } catch {
            parsed = buffer;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsed
          });
        });
      });
      req.on('error', reject);
      if (body) {
        if (Buffer.isBuffer(body) || typeof body === 'string') {
          req.write(body);
        } else {
          req.write(JSON.stringify(body));
        }
      }
      req.end();
    });
  }

  // Generate unique test prefix to ensure cleanup
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  console.log(`[Setup] Test run ID for synthetic accounts: ${runId}`);

  // Test data variables
  let patientUser, patientDoc;
  let doctorUser1, doctorDoc1; // Active treating doctor
  let doctorUser2, doctorDoc2; // Reassignment doctor
  let doctorUser3, doctorDoc3; // Unassigned / Duty doctor
  let pharmacyUser;
  let assignment1;

  let patientToken, doctorToken1, doctorToken2, doctorToken3, pharmacyToken;

  const testResults = {
    messaging: [],
    vault: []
  };

  function assert(suite, name, condition, details = '') {
    if (condition) {
      console.log(`  PASS: [${suite}] ${name}`);
      testResults[suite].push({ name, status: 'PASS', details });
    } else {
      console.error(`  FAIL: [${suite}] ${name} - ${details}`);
      testResults[suite].push({ name, status: 'FAIL', details });
      throw new Error(`Assertion failed: [${suite}] ${name}: ${details}`);
    }
  }

  try {
    // -------------------------------------------------------------
    // Setup synthetic database documents
    // -------------------------------------------------------------
    console.log('[Setup] Creating synthetic test users, doctors, patient, and assignments...');

    // Patient
    patientUser = await User.create({
      name: `Synthetic Patient ${runId}`,
      email: `patient_${runId}@synthetic.shms`,
      passwordHash: '$2b$10$wT5g1z2b1Jc4f9j8k7l6m5n4o3p2q1r0s9t8u7v6w5x4y3z2a1b0', // dummy bcrypt
      role: 'PATIENT',
      permissions: [],
      status: 'ACTIVE'
    });
    patientDoc = await Patient.create({
      userId: patientUser._id,
      patientNumber: `P-${runId.toUpperCase()}`,
      name: patientUser.name,
      dateOfBirth: new Date('1990-01-01'),
      status: 'ACTIVE'
    });

    // Doctor 1 (Active Treating Doctor, with VAULT_ACCESS)
    doctorUser1 = await User.create({
      name: `Dr. Treating One ${runId}`,
      email: `doctor1_${runId}@synthetic.shms`,
      passwordHash: '$2b$10$wT5g1z2b1Jc4f9j8k7l6m5n4o3p2q1r0s9t8u7v6w5x4y3z2a1b0',
      role: 'DOCTOR',
      permissions: ['VAULT_ACCESS'],
      status: 'ACTIVE'
    });
    doctorDoc1 = await Doctor.create({
      userId: doctorUser1._id,
      doctorNumber: `DOC-1-${runId.toUpperCase()}`,
      name: doctorUser1.name,
      department: 'Cardiology',
      specialization: 'Cardiologist',
      registrationReference: `REG-1-${runId}`,
      status: 'ACTIVE'
    });

    // Doctor 2 (New Treating Doctor for reassignment, no vault permission initially)
    doctorUser2 = await User.create({
      name: `Dr. Treating Two ${runId}`,
      email: `doctor2_${runId}@synthetic.shms`,
      passwordHash: '$2b$10$wT5g1z2b1Jc4f9j8k7l6m5n4o3p2q1r0s9t8u7v6w5x4y3z2a1b0',
      role: 'DOCTOR',
      permissions: [],
      status: 'ACTIVE'
    });
    doctorDoc2 = await Doctor.create({
      userId: doctorUser2._id,
      doctorNumber: `DOC-2-${runId.toUpperCase()}`,
      name: doctorUser2.name,
      department: 'Neurology',
      specialization: 'Neurologist',
      registrationReference: `REG-2-${runId}`,
      status: 'ACTIVE'
    });

    // Doctor 3 (Unrelated doctor, has DUTY_DOCTOR permission only)
    doctorUser3 = await User.create({
      name: `Dr. Duty Doctor ${runId}`,
      email: `doctor3_${runId}@synthetic.shms`,
      passwordHash: '$2b$10$wT5g1z2b1Jc4f9j8k7l6m5n4o3p2q1r0s9t8u7v6w5x4y3z2a1b0',
      role: 'DOCTOR',
      permissions: ['DUTY_DOCTOR'],
      status: 'ACTIVE'
    });
    doctorDoc3 = await Doctor.create({
      userId: doctorUser3._id,
      doctorNumber: `DOC-3-${runId.toUpperCase()}`,
      name: doctorUser3.name,
      department: 'Emergency',
      specialization: 'Emergency Medicine',
      registrationReference: `REG-3-${runId}`,
      status: 'ACTIVE'
    });

    // Pharmacy
    pharmacyUser = await User.create({
      name: `Pharmacy Staff ${runId}`,
      email: `pharmacy_${runId}@synthetic.shms`,
      passwordHash: '$2b$10$wT5g1z2b1Jc4f9j8k7l6m5n4o3p2q1r0s9t8u7v6w5x4y3z2a1b0',
      role: 'PHARMACY',
      permissions: [],
      status: 'ACTIVE'
    });

    // Active treating assignment between Patient and Doctor 1
    assignment1 = await DoctorAssignment.create({
      patientId: patientDoc._id,
      doctorId: doctorDoc1._id,
      assignedBy: doctorUser1._id,
      assignmentType: 'TREATING',
      status: 'ACTIVE',
      startDate: new Date()
    });

    // Tokens
    patientToken = generateToken(patientUser);
    doctorToken1 = generateToken(doctorUser1);
    doctorToken2 = generateToken(doctorUser2);
    doctorToken3 = generateToken(doctorUser3);
    pharmacyToken = generateToken(pharmacyUser);

    console.log('[Setup] Test data initialized successfully.\n');

    // =========================================================================
    // SECTION 4: MESSAGING SCENARIOS
    // =========================================================================
    console.log('--- 4. MESSAGING SCENARIOS ---');

    // 4.1 Patient can create/retrieve conversation with active treating doctor
    const m1Res = await apiRequest('POST', '/api/conversations', { token: patientToken, body: {} });
    assert('messaging', '1. Patient creates conversation with active treating doctor',
      m1Res.statusCode === 201 && m1Res.body?.success === true && m1Res.body?.data?.conversation,
      `Status: ${m1Res.statusCode}`
    );
    const conversationId = m1Res.body.data.conversation._id;

    // 4.2 Assigned treating doctor can retrieve and reply to that conversation
    const m2ListRes = await apiRequest('GET', '/api/conversations', { token: doctorToken1 });
    assert('messaging', '2. Assigned doctor retrieves the conversation in their inbox',
      m2ListRes.statusCode === 200 && m2ListRes.body?.data?.conversations?.some(c => c._id === conversationId),
      `Found: ${m2ListRes.body?.data?.conversations?.length || 0}`
    );

    const m2SendRes = await apiRequest('POST', `/api/conversations/${conversationId}/messages`, {
      token: doctorToken1,
      body: { body: 'Hello from Dr. Treating One. How are you feeling today?' }
    });
    assert('messaging', '2b. Assigned doctor replies to conversation',
      m2SendRes.statusCode === 201 && m2SendRes.body?.data?.message?.body?.includes('How are you feeling'),
      `Status: ${m2SendRes.statusCode}`
    );
    const doctorMsgId = m2SendRes.body.data.message._id;

    // 4.3 Patient can send and retrieve messages
    const m3SendRes = await apiRequest('POST', `/api/conversations/${conversationId}/messages`, {
      token: patientToken,
      body: { body: 'Thank you doctor, I am feeling much better.' }
    });
    assert('messaging', '3. Patient can send message to doctor',
      m3SendRes.statusCode === 201 && m3SendRes.body?.data?.message?.senderId === String(patientUser._id),
      `Sender: ${m3SendRes.body?.data?.message?.senderId}`
    );
    const patientMsgId = m3SendRes.body.data.message._id;

    const m3ListRes = await apiRequest('GET', `/api/conversations/${conversationId}/messages`, {
      token: patientToken
    });
    assert('messaging', '3b. Patient can retrieve messages in conversation',
      m3ListRes.statusCode === 200 && m3ListRes.body?.data?.messages?.length === 2,
      `Message count: ${m3ListRes.body?.data?.messages?.length}`
    );

    // 4.4 Recipient can mark a message as read
    const m4ReadRes = await apiRequest('PATCH', `/api/conversations/${conversationId}/messages/${doctorMsgId}/read`, {
      token: patientToken
    });
    assert('messaging', '4. Recipient marks message as read',
      m4ReadRes.statusCode === 200 && m4ReadRes.body?.data?.message?.readAt !== null,
      `ReadAt: ${m4ReadRes.body?.data?.message?.readAt}`
    );

    // Non-recipient cannot mark message as read
    const m4InvalidRead = await apiRequest('PATCH', `/api/conversations/${conversationId}/messages/${patientMsgId}/read`, {
      token: patientToken // Patient sent patientMsgId, so patient is sender not recipient
    });
    assert('messaging', '4b. Sender cannot mark their own sent message as read',
      m4InvalidRead.statusCode === 403,
      `Status: ${m4InvalidRead.statusCode}`
    );

    // 4.5 Unrelated doctor cannot access the conversation
    const m5Res = await apiRequest('GET', `/api/conversations/${conversationId}/messages`, {
      token: doctorToken2
    });
    assert('messaging', '5. Unrelated doctor cannot access the conversation',
      m5Res.statusCode === 403,
      `Status: ${m5Res.statusCode}`
    );

    // 4.6 & 4.8 Reassignment: Doctor 1 loses access; New Doctor 2 receives appropriate new conversation
    // Perform reassignment in DB (DoctorAssignment status is 'ACTIVE' | 'CLOSED')
    assignment1.status = 'CLOSED';
    assignment1.endDate = new Date();
    await assignment1.save();

    const assignment2 = await DoctorAssignment.create({
      patientId: patientDoc._id,
      doctorId: doctorDoc2._id,
      assignedBy: doctorUser2._id,
      assignmentType: 'TREATING',
      status: 'ACTIVE',
      startDate: new Date()
    });

    const m6Doctor1Access = await apiRequest('POST', `/api/conversations/${conversationId}/messages`, {
      token: doctorToken1,
      body: { body: 'Attempting to send message after reassignment' }
    });
    assert('messaging', '6. Previous doctor loses access after reassignment',
      m6Doctor1Access.statusCode === 403,
      `Status: ${m6Doctor1Access.statusCode}`
    );

    // 4.7 Patient retains their historical conversation
    const m7PatientHist = await apiRequest('GET', `/api/conversations/${conversationId}/messages`, {
      token: patientToken
    });
    assert('messaging', '7. Patient retains their historical conversation',
      m7PatientHist.statusCode === 200 && m7PatientHist.body?.data?.messages?.length >= 2,
      `History count: ${m7PatientHist.body?.data?.messages?.length}`
    );

    // 4.8 New treating doctor receives the appropriate new conversation
    const m8NewConv = await apiRequest('POST', '/api/conversations', {
      token: patientToken,
      body: {}
    });
    assert('messaging', '8. New treating doctor conversation is created for patient',
      m8NewConv.statusCode === 201 && m8NewConv.body?.data?.conversation?._id !== conversationId,
      `New Conv ID: ${m8NewConv.body?.data?.conversation?._id}`
    );
    const conversationId2 = m8NewConv.body.data.conversation._id;

    const m8Doc2Send = await apiRequest('POST', `/api/conversations/${conversationId2}/messages`, {
      token: doctorToken2,
      body: { body: 'Welcome, I am Dr. Treating Two, your new doctor.' }
    });
    assert('messaging', '8b. New treating doctor can message on the new conversation',
      m8Doc2Send.statusCode === 201,
      `Status: ${m8Doc2Send.statusCode}`
    );

    // 4.9 DUTY_DOCTOR permission alone does not grant messaging access
    const m9DutyRes = await apiRequest('POST', '/api/conversations', {
      token: doctorToken3,
      body: { patientId: String(patientDoc._id) }
    });
    assert('messaging', '9. DUTY_DOCTOR permission alone does not grant messaging access',
      m9DutyRes.statusCode === 403,
      `Status: ${m9DutyRes.statusCode}`
    );

    // 4.10 PHARMACY cannot access messaging
    const m10Pharmacy = await apiRequest('GET', '/api/conversations', {
      token: pharmacyToken
    });
    assert('messaging', '10. PHARMACY cannot access messaging',
      m10Pharmacy.statusCode === 403,
      `Status: ${m10Pharmacy.statusCode}`
    );

    // 4.11 Client-supplied sender/recipient identity fields cannot impersonate another user
    const m11Impersonate = await apiRequest('POST', `/api/conversations/${conversationId2}/messages`, {
      token: patientToken,
      body: {
        body: 'Spoofing sender',
        senderId: String(doctorUser2._id),
        recipientId: String(patientUser._id)
      }
    });
    assert('messaging', '11. Client-supplied sender/recipient identity fields are rejected',
      m11Impersonate.statusCode === 400,
      `Status: ${m11Impersonate.statusCode}`
    );

    // 4.12 Message content and pagination limits are enforced
    const m12Empty = await apiRequest('POST', `/api/conversations/${conversationId2}/messages`, {
      token: patientToken,
      body: { body: '   ' }
    });
    const m12TooLong = await apiRequest('POST', `/api/conversations/${conversationId2}/messages`, {
      token: patientToken,
      body: { body: 'a'.repeat(4001) }
    });
    assert('messaging', '12. Message length limits enforced (rejects empty and >4000 chars)',
      m12Empty.statusCode === 400 && m12TooLong.statusCode === 400,
      `Empty: ${m12Empty.statusCode}, Long: ${m12TooLong.statusCode}`
    );

    const m12Pagination = await apiRequest('GET', `/api/conversations/${conversationId2}/messages?limit=1`, {
      token: patientToken
    });
    assert('messaging', '12b. Pagination limit is enforced on message listing',
      m12Pagination.statusCode === 200 && m12Pagination.body?.data?.messages?.length === 1,
      `Returned: ${m12Pagination.body?.data?.messages?.length}`
    );


    // =========================================================================
    // SECTION 5: DOCUMENT VAULT SCENARIOS
    // =========================================================================
    console.log('\n--- 5. DOCUMENT VAULT SCENARIOS ---');

    // Helper for multipart/form-data upload
    function createMultipartBody(fieldName, filename, contentType, buffer) {
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
      const pre = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`
      );
      const post = Buffer.from(`\r\n--${boundary}--\r\n`);
      const body = Buffer.concat([pre, buffer, post]);
      return {
        body,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(body.length)
        }
      };
    }

    // 5.1 DOCTOR with VAULT_ACCESS can list documents
    const v1ListRes = await apiRequest('GET', '/api/vault/documents', { token: doctorToken1 });
    assert('vault', '1. DOCTOR with VAULT_ACCESS can list documents',
      v1ListRes.statusCode === 200 && Array.isArray(v1ListRes.body?.data?.documents),
      `Status: ${v1ListRes.statusCode}`
    );

    // 5.2 Authorized doctor can upload a valid PDF
    const validPdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
    const pdfMulti = createMultipartBody('file', 'clinical_summary.pdf', 'application/pdf', validPdfBuffer);
    const v2UploadPdf = await apiRequest('POST', '/api/vault/documents', {
      token: doctorToken1,
      body: pdfMulti.body,
      headers: pdfMulti.headers,
      isMultipart: true
    });
    assert('vault', '2. Authorized doctor can upload a valid PDF',
      v2UploadPdf.statusCode === 201 && v2UploadPdf.body?.data?.document?.originalFilename === 'clinical_summary.pdf',
      `Status: ${v2UploadPdf.statusCode}, File: ${v2UploadPdf.body?.data?.document?.originalFilename}`
    );
    const pdfDocId = v2UploadPdf.body.data.document._id;

    // 5.3 Authorized doctor can upload valid PNG and JPEG files
    const validPngBuffer = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0, 0, 0, 13]),
      Buffer.from('IHDR'),
      Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
      Buffer.from([0, 0, 0, 0])
    ]);
    const pngMulti = createMultipartBody('file', 'scan.png', 'image/png', validPngBuffer);
    const v3UploadPng = await apiRequest('POST', '/api/vault/documents', {
      token: doctorToken1,
      body: pngMulti.body,
      headers: pngMulti.headers,
      isMultipart: true
    });

    const validJpgBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0xff, 0xd9]);
    const jpgMulti = createMultipartBody('file', 'xray.jpeg', 'image/jpeg', validJpgBuffer);
    const v3UploadJpg = await apiRequest('POST', '/api/vault/documents', {
      token: doctorToken1,
      body: jpgMulti.body,
      headers: jpgMulti.headers,
      isMultipart: true
    });

    assert('vault', '3. Authorized doctor can upload valid PNG/JPEG files',
      v3UploadPng.statusCode === 201 && v3UploadJpg.statusCode === 201,
      `PNG Status: ${v3UploadPng.statusCode}, JPEG Status: ${v3UploadJpg.statusCode}`
    );

    // 5.4 Oversized files are rejected (> 5 MiB)
    const oversizedBuffer = Buffer.alloc(5 * 1024 * 1024 + 1024, 0x20); // 5 MiB + 1 KB
    const overMulti = createMultipartBody('file', 'huge.pdf', 'application/pdf', oversizedBuffer);
    const v4Over = await apiRequest('POST', '/api/vault/documents', {
      token: doctorToken1,
      body: overMulti.body,
      headers: overMulti.headers,
      isMultipart: true
    });
    assert('vault', '4. Oversized files (> 5 MiB) are rejected',
      v4Over.statusCode === 413,
      `Status: ${v4Over.statusCode}`
    );

    // 5.5 Unsupported file types and invalid file signatures are rejected
    const exeBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00');
    const exeMulti = createMultipartBody('file', 'malicious.exe', 'application/x-msdownload', exeBuffer);
    const v5Exe = await apiRequest('POST', '/api/vault/documents', {
      token: doctorToken1,
      body: exeMulti.body,
      headers: exeMulti.headers,
      isMultipart: true
    });

    // Fake PDF: named .pdf and mime application/pdf but bytes are plain text
    const fakePdfBuffer = Buffer.from('This is not really a PDF file at all.');
    const fakePdfMulti = createMultipartBody('file', 'fake.pdf', 'application/pdf', fakePdfBuffer);
    const v5FakePdf = await apiRequest('POST', '/api/vault/documents', {
      token: doctorToken1,
      body: fakePdfMulti.body,
      headers: fakePdfMulti.headers,
      isMultipart: true
    });

    assert('vault', '5. Unsupported file types and invalid signatures are rejected',
      (v5Exe.statusCode === 400 || v5Exe.statusCode === 415) &&
      (v5FakePdf.statusCode === 400 || v5FakePdf.statusCode === 415),
      `Exe Status: ${v5Exe.statusCode}, Fake PDF Status: ${v5FakePdf.statusCode}`
    );

    // 5.6 Authorized doctor can download their own document
    const v6Download = await apiRequest('GET', `/api/vault/documents/${pdfDocId}/download`, {
      token: doctorToken1
    });
    assert('vault', '6. Authorized doctor can download their own document',
      v6Download.statusCode === 200 &&
      v6Download.headers['content-type'] === 'application/pdf' &&
      v6Download.headers['content-disposition']?.includes('clinical_summary.pdf') &&
      Buffer.isBuffer(v6Download.body) && v6Download.body.slice(0, 4).toString() === '%PDF',
      `Status: ${v6Download.statusCode}, Length: ${v6Download.body.length}`
    );

    // 5.7 Another doctor cannot access or download that document
    // Doctor 2 also gets VAULT_ACCESS to test cross-doctor isolation
    doctorUser2.permissions.push('VAULT_ACCESS');
    await doctorUser2.save();
    const doctorToken2Vault = generateToken(doctorUser2);

    const v7DownloadOther = await apiRequest('GET', `/api/vault/documents/${pdfDocId}/download`, {
      token: doctorToken2Vault
    });
    assert('vault', '7. Another doctor cannot access or download another doctor document',
      v7DownloadOther.statusCode === 404,
      `Status: ${v7DownloadOther.statusCode}`
    );

    // 5.8 Doctor without VAULT_ACCESS is denied
    const doctorUserNoVault = await User.create({
      name: `Dr. No Vault ${runId}`,
      email: `novault_${runId}@synthetic.shms`,
      passwordHash: '$2b$10$wT5g1z2b1Jc4f9j8k7l6m5n4o3p2q1r0s9t8u7v6w5x4y3z2a1b0',
      role: 'DOCTOR',
      permissions: [],
      status: 'ACTIVE'
    });
    await Doctor.create({
      userId: doctorUserNoVault._id,
      doctorNumber: `DOC-NV-${runId.toUpperCase()}`,
      name: doctorUserNoVault.name,
      department: 'General',
      specialization: 'Physician',
      registrationReference: `REG-NV-${runId}`,
      status: 'ACTIVE'
    });
    const tokenNoVault = generateToken(doctorUserNoVault);

    const v8Denied = await apiRequest('GET', '/api/vault/documents', { token: tokenNoVault });
    assert('vault', '8. Doctor without VAULT_ACCESS is denied (HTTP 403)',
      v8Denied.statusCode === 403,
      `Status: ${v8Denied.statusCode}`
    );

    // 5.9 PATIENT and PHARMACY are denied
    const v9Patient = await apiRequest('GET', '/api/vault/documents', { token: patientToken });
    const v9Pharmacy = await apiRequest('GET', '/api/vault/documents', { token: pharmacyToken });
    assert('vault', '9. PATIENT and PHARMACY are denied vault access (HTTP 403)',
      v9Patient.statusCode === 403 && v9Pharmacy.statusCode === 403,
      `Patient: ${v9Patient.statusCode}, Pharmacy: ${v9Pharmacy.statusCode}`
    );

    // 5.10 Soft deletion prevents subsequent API access to the document
    const v10Delete = await apiRequest('DELETE', `/api/vault/documents/${pdfDocId}`, {
      token: doctorToken1
    });
    assert('vault', '10. Authorized doctor can soft-delete an owned document',
      v10Delete.statusCode === 200 && v10Delete.body?.data?.document?.status === 'DELETED',
      `Status: ${v10Delete.statusCode}`
    );

    // Subsequent download gives 404
    const v10DownloadPostDelete = await apiRequest('GET', `/api/vault/documents/${pdfDocId}/download`, {
      token: doctorToken1
    });
    // Subsequent list excludes document
    const v10ListPostDelete = await apiRequest('GET', '/api/vault/documents', {
      token: doctorToken1
    });
    const inList = v10ListPostDelete.body?.data?.documents?.some(d => d._id === pdfDocId);
    assert('vault', '10b. Soft-deleted document is blocked from download and excluded from active list',
      v10DownloadPostDelete.statusCode === 404 && inList === false,
      `Download status: ${v10DownloadPostDelete.statusCode}, In list: ${inList}`
    );

    // 5.11 Unauthorized attempts and successful sensitive operations generate expected audit records
    const auditEntries = await AuditLog.find({
      $or: [
        { actorId: doctorUser1._id },
        { actorId: doctorUser2._id },
        { actorId: patientUser._id },
        { actorId: doctorUserNoVault._id }
      ]
    }).lean();

    const uploadAudit = auditEntries.find(a => a.action === 'VAULT_DOCUMENT_UPLOADED');
    const deleteAudit = auditEntries.find(a => a.action === 'VAULT_DOCUMENT_DELETED');
    const downloadAudit = auditEntries.find(a => a.action === 'VAULT_DOCUMENT_DOWNLOADED');
    const deniedAudit = auditEntries.find(a => a.action === 'VAULT_ACCESS_DENIED');

    assert('vault', '11. Sensitive vault operations and denied attempts persist expected audit records',
      !!uploadAudit && !!deleteAudit && !!downloadAudit && !!deniedAudit,
      `Upload: ${!!uploadAudit}, Delete: ${!!deleteAudit}, Download: ${!!downloadAudit}, Denied: ${!!deniedAudit}`
    );

    // 5.12 Failed uploads do not leave unintended database records or orphaned files
    // Let's verify DB count of DocumentVault documents matches exactly the 3 created (1 deleted, 2 active)
    const vaultDocsCount = await DocumentVault.countDocuments({ ownerDoctorId: doctorDoc1._id });
    assert('vault', '12. Failed uploads (oversized, invalid signatures) do not create DocumentVault records',
      vaultDocsCount === 3, // 1 PDF (deleted), 1 PNG, 1 JPG
      `Vault count in DB: ${vaultDocsCount}`
    );

    console.log('\n============================================================');
    console.log('   ALL REAL MONGODB & API INTEGRATION SCENARIOS PASSED!');
    console.log('============================================================\n');

  } finally {
    // Cleanup synthetic test records
    console.log('[Cleanup] Cleaning up synthetic test data from database...');
    try {
      if (patientUser) {
        await Conversation.deleteMany({ patientId: patientDoc?._id });
        await Message.deleteMany({ $or: [{ senderId: patientUser._id }, { recipientId: patientUser._id }] });
        await DoctorAssignment.deleteMany({ patientId: patientDoc?._id });
        await Patient.deleteOne({ _id: patientDoc?._id });
        await User.deleteOne({ _id: patientUser._id });
      }
      if (doctorUser1) {
        // Remove storage files created during test
        const docs = await DocumentVault.find({ ownerDoctorId: doctorDoc1._id }).select('+storageKey').lean();
        const root = path.resolve(__dirname, '..', env.VAULT_STORAGE_PATH);
        for (const d of docs) {
          if (d.storageKey) {
            try { fs.unlinkSync(path.join(root, d.storageKey)); } catch {}
          }
        }
        await DocumentVault.deleteMany({ ownerDoctorId: doctorDoc1._id });
        await Doctor.deleteOne({ _id: doctorDoc1._id });
        await User.deleteOne({ _id: doctorUser1._id });
      }
      if (doctorUser2) {
        await Doctor.deleteOne({ _id: doctorDoc2._id });
        await User.deleteOne({ _id: doctorUser2._id });
      }
      if (doctorUser3) {
        await Doctor.deleteOne({ _id: doctorDoc3._id });
        await User.deleteOne({ _id: doctorUser3._id });
      }
      if (pharmacyUser) {
        await User.deleteOne({ _id: pharmacyUser._id });
      }
      await AuditLog.deleteMany({
        actorId: {
          $in: [patientUser?._id, doctorUser1?._id, doctorUser2?._id, doctorUser3?._id, pharmacyUser?._id].filter(Boolean)
        }
      });
      console.log('[Cleanup] Database cleanup complete.');
    } catch (cleanupErr) {
      console.warn('[Cleanup] Cleanup warning:', cleanupErr.message);
    }

    server.close();
    await mongoose.disconnect();
  }
}

runLiveIntegrationVerification().catch((err) => {
  console.error('\n[FATAL TEST FAILURE]', err);
  process.exit(1);
});
