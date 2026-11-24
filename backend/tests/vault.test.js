'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const app = require('../src/app');
const AuditLog = require('../src/models/AuditLog');
const Doctor = require('../src/models/Doctor');
const DocumentVault = require('../src/models/DocumentVault');
const User = require('../src/models/User');
const env = require('../src/config/env');
const generateToken = require('../src/utils/generateToken');

const users = new Map();
const doctors = new Map();
const documents = new Map();
const auditLogs = [];
const storageDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hospital-vault-test-'));
const originalStoragePath = env.VAULT_STORAGE_PATH;
const originals = {
  userFindById: User.findById,
  doctorFindOne: Doctor.findOne,
  documentFind: DocumentVault.find,
  documentFindById: DocumentVault.findById,
  documentFindOne: DocumentVault.findOne,
  documentCountDocuments: DocumentVault.countDocuments,
  documentSave: DocumentVault.prototype.save,
  auditSave: AuditLog.prototype.save,
  readyState: Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState'),
  client: Object.getOwnPropertyDescriptor(mongoose.connection, 'client'),
  transaction: Object.getOwnPropertyDescriptor(mongoose.connection, 'transaction')
};

let server;
let failAuditAction = null;
let failDocumentSave = false;
let commitThenThrow = false;
let passed = 0;
let failed = 0;

const idOf = (value) => String(value);

const matches = (record, filter) =>
  Object.entries(filter).every(([field, expected]) => {
    const actual = record[field];
    if (expected && typeof expected === 'object' && expected.$in) {
      return expected.$in.some((candidate) => idOf(actual) === idOf(candidate));
    }
    return idOf(actual) === idOf(expected);
  });

const makeQuery = (getter, Model, isList = false) => {
  let sortFields = null;
  let skip = 0;
  let limit = Number.MAX_SAFE_INTEGER;
  let leanResult = false;
  const resolve = () => {
    let rows = getter();
    rows = isList ? rows.slice() : rows ? [rows] : [];
    if (sortFields) {
      rows.sort((left, right) => {
        for (const [field, direction] of Object.entries(sortFields)) {
          const a = left[field] instanceof Date ? left[field].getTime() : String(left[field]);
          const b = right[field] instanceof Date ? right[field].getTime() : String(right[field]);
          if (a !== b) return a < b ? -direction : direction;
        }
        return 0;
      });
    }
    if (isList) rows = rows.slice(skip, skip + limit);
    if (leanResult || isList) {
      const plain = rows.map((row) => ({ ...row }));
      return isList ? plain : plain[0] || null;
    }
    const hydrated = rows.map((row) => new Model({ ...row }));
    return isList ? hydrated : hydrated[0] || null;
  };
  const query = {
    select() { return this; },
    sort(value) { sortFields = value; return this; },
    skip(value) { skip = value; return this; },
    limit(value) { limit = value; return this; },
    session() { return this; },
    lean() {
      leanResult = true;
      return Promise.resolve(resolve());
    },
    then(resolvePromise, rejectPromise) {
      return Promise.resolve(resolve()).then(resolvePromise, rejectPromise);
    }
  };
  return query;
};

const setTopology = (type) => {
  Object.defineProperty(mongoose.connection, 'readyState', {
    configurable: true,
    value: 1
  });
  Object.defineProperty(mongoose.connection, 'client', {
    configurable: true,
    value: { topology: { description: { type } } }
  });
  Object.defineProperty(mongoose.connection, 'transaction', {
    configurable: true,
    value: async (operation) => {
      const oldDocuments = new Map(
        Array.from(documents, ([id, document]) => [id, { ...document }])
      );
      const oldAuditLength = auditLogs.length;
      try {
        const result = await operation({ mockedTransaction: true });
        if (commitThenThrow) {
          commitThenThrow = false;
          const error = new Error('Simulated commit acknowledgement loss');
          error.transactionCommitted = true;
          throw error;
        }
        return result;
      } catch (error) {
        if (error.transactionCommitted) throw error;
        documents.clear();
        for (const [id, document] of oldDocuments) documents.set(id, document);
        auditLogs.splice(oldAuditLength);
        throw error;
      }
    }
  });
};

const setupMocks = () => {
  setTopology('ReplicaSetWithPrimary');
  User.findById = (id) => makeQuery(() => users.get(idOf(id)) || null, User);
  Doctor.findOne = (filter) =>
    makeQuery(
      () => Array.from(doctors.values()).find((doctor) => matches(doctor, filter)) || null,
      Doctor
    );
  DocumentVault.find = (filter) =>
    makeQuery(
      () => Array.from(documents.values()).filter((document) => matches(document, filter)),
      DocumentVault,
      true
    );
  DocumentVault.findById = (id) =>
    makeQuery(() => documents.get(idOf(id)) || null, DocumentVault);
  DocumentVault.findOne = (filter) =>
    makeQuery(
      () => Array.from(documents.values()).find((document) => matches(document, filter)) || null,
      DocumentVault
    );
  DocumentVault.countDocuments = async (filter) =>
    Array.from(documents.values()).filter((document) => matches(document, filter)).length;
  DocumentVault.prototype.save = async function (options = {}) {
    if (failDocumentSave) throw new Error('Simulated document metadata failure');
    const key = idOf(this._id);
    for (const [existingId, existing] of documents) {
      if (existingId !== key && existing.storageKey === this.storageKey) {
        const error = new Error('Duplicate storage key');
        error.code = 11000;
        throw error;
      }
    }
    this.createdAt = this.createdAt || new Date();
    this.updatedAt = new Date();
    documents.set(key, this.toObject());
    return this;
  };
  AuditLog.prototype.save = async function () {
    if (failAuditAction === this.action) {
      throw new Error('Simulated audit persistence failure');
    }
    auditLogs.push(this.toObject());
    return this;
  };
};

const restoreMocks = () => {
  User.findById = originals.userFindById;
  Doctor.findOne = originals.doctorFindOne;
  DocumentVault.find = originals.documentFind;
  DocumentVault.findById = originals.documentFindById;
  DocumentVault.findOne = originals.documentFindOne;
  DocumentVault.countDocuments = originals.documentCountDocuments;
  DocumentVault.prototype.save = originals.documentSave;
  AuditLog.prototype.save = originals.auditSave;
  if (originals.readyState) {
    Object.defineProperty(mongoose.connection, 'readyState', originals.readyState);
  }
  if (originals.client) {
    Object.defineProperty(mongoose.connection, 'client', originals.client);
  }
  if (originals.transaction) {
    Object.defineProperty(mongoose.connection, 'transaction', originals.transaction);
  } else {
    delete mongoose.connection.transaction;
  }
  env.VAULT_STORAGE_PATH = originalStoragePath;
};

const addUser = (role, permissions = []) => {
  const user = {
    _id: new mongoose.Types.ObjectId(),
    role,
    permissions,
    status: 'ACTIVE'
  };
  users.set(idOf(user._id), user);
  return user;
};

const addDoctor = (user, status = 'ACTIVE') => {
  const doctor = {
    _id: new mongoose.Types.ObjectId(),
    userId: user._id,
    status
  };
  doctors.set(idOf(doctor._id), doctor);
  return doctor;
};

const addDocument = (doctor, properties = {}) => {
  const now = new Date();
  const document = {
    _id: new mongoose.Types.ObjectId(),
    ownerDoctorId: doctor._id,
    uploadedBy: doctor.userId,
    originalFilename: 'existing.pdf',
    storageKey: cryptoKey(),
    mimeType: 'application/pdf',
    fileSize: 16,
    uploadedAt: now,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
    ...properties
  };
  documents.set(idOf(document._id), document);
  return document;
};

const cryptoKey = () => require('crypto').randomBytes(32).toString('hex');

const makeMultipart = (filename, mimeType, fileBuffer) => {
  const boundary = `----hospital-vault-${require('crypto').randomBytes(8).toString('hex')}`;
  const prefix = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    boundary,
    body: Buffer.concat([prefix, fileBuffer, suffix])
  };
};

const request = (method, url, { token, body, contentType } = {}) =>
  new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) {
      headers['Content-Type'] = contentType || 'application/json';
      headers['Content-Length'] = body.length;
    }
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: server.address().port,
        path: url,
        method,
        headers
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          let json = null;
          if ((res.headers['content-type'] || '').includes('application/json')) {
            try {
              json = JSON.parse(raw.toString('utf8'));
            } catch (_) {
              json = null;
            }
          }
          resolve({
            statusCode: res.statusCode,
            body: json,
            raw,
            headers: res.headers
          });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });

const upload = (token, filename, mimeType, buffer) => {
  const multipart = makeMultipart(filename, mimeType, buffer);
  return request('POST', '/api/vault/documents', {
    token,
    body: multipart.body,
    contentType: `multipart/form-data; boundary=${multipart.boundary}`
  });
};

const pdf = Buffer.from('%PDF-1.7\nvault test\n%%EOF', 'ascii');
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0, 0, 0, 13]),
  Buffer.from('IHDR'),
  Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
  Buffer.from([0, 0, 0, 0])
]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0xff, 0xd9]);

const test = async (description, operation) => {
  try {
    await operation();
    passed++;
    console.log(`  PASS: ${description}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL: ${description}`);
    console.error(error);
  }
};

const fileCount = async () => {
  const entries = await fs.promises.readdir(storageDirectory, { withFileTypes: true })
    .catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error));
  let count = 0;
  for (const entry of entries) {
    if (entry.name === '.staging') continue;
    if (entry.isFile()) count++;
  }
  return count;
};

const main = async () => {
  setupMocks();
  env.VAULT_STORAGE_PATH = storageDirectory;

  const doctorUser = addUser('DOCTOR', ['VAULT_ACCESS']);
  const doctor = addDoctor(doctorUser);
  const otherDoctorUser = addUser('DOCTOR', ['VAULT_ACCESS']);
  const otherDoctor = addDoctor(otherDoctorUser);
  const noPermissionUser = addUser('DOCTOR');
  addDoctor(noPermissionUser);
  const patientUser = addUser('PATIENT');
  const pharmacyUser = addUser('PHARMACY');
  const inactiveDoctorUser = addUser('DOCTOR', ['VAULT_ACCESS']);
  addDoctor(inactiveDoctorUser, 'INACTIVE');
  const tokens = {
    doctor: generateToken(doctorUser),
    otherDoctor: generateToken(otherDoctorUser),
    noPermission: generateToken(noPermissionUser),
    patient: generateToken(patientUser),
    pharmacy: generateToken(pharmacyUser),
    inactiveDoctor: generateToken(inactiveDoctorUser)
  };

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  await test('authorized doctor can list only owned documents with pagination', async () => {
    addDocument(doctor, { originalFilename: 'a.pdf' });
    addDocument(doctor, { originalFilename: 'b.pdf' });
    addDocument(otherDoctor, { originalFilename: 'private.pdf' });
    const result = await request('GET', '/api/vault/documents?page=1&limit=1', {
      token: tokens.doctor
    });
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.data.documents.length, 1);
    assert.strictEqual(result.body.data.pagination.total, 2);
    assert.strictEqual(result.body.data.pagination.page, 1);
    assert.ok(!JSON.stringify(result.body).includes('storageKey'));
    const audit = auditLogs.find((entry) => entry.action === 'VAULT_DOCUMENTS_LISTED');
    assert.ok(audit);
    assert.strictEqual(String(audit.actorId), String(doctorUser._id));
    assert.strictEqual(audit.outcome, 'SUCCESS');
    assert.ok(audit.ipAddress);
  });

  await test('patient, pharmacy, doctor without permission, and inactive doctor are denied and audited', async () => {
    for (const token of [
      tokens.patient,
      tokens.pharmacy,
      tokens.noPermission,
      tokens.inactiveDoctor
    ]) {
      const result = await request('GET', '/api/vault/documents', { token });
      assert.strictEqual(result.statusCode, 403);
    }
    assert.ok(auditLogs.filter((audit) => audit.action === 'VAULT_ACCESS_DENIED').length >= 4);
  });

  await test('valid PDF, PNG, and JPEG uploads are accepted without exposing storage keys', async () => {
    const cases = [
      ['record.pdf', 'application/pdf', pdf],
      ['scan.png', 'image/png', png],
      ['photo.jpeg', 'image/jpeg', jpeg]
    ];
    for (const [filename, mimeType, contents] of cases) {
      const result = await upload(tokens.doctor, filename, mimeType, contents);
      assert.strictEqual(result.statusCode, 201);
      assert.strictEqual(result.body.data.document.originalFilename, filename);
      assert.ok(!JSON.stringify(result.body).includes('storageKey'));
      assert.ok(!JSON.stringify(result.body).includes(storageDirectory));
    }
    assert.strictEqual(await fileCount(), 3);
    const uploadAudit = auditLogs.find((entry) => entry.action === 'VAULT_DOCUMENT_UPLOADED');
    assert.ok(uploadAudit);
    assert.strictEqual(String(uploadAudit.actorId), String(doctorUser._id));
    assert.strictEqual(uploadAudit.outcome, 'SUCCESS');
  });

  await test('unsupported signatures and mismatched MIME or extension are rejected', async () => {
    const invalidSignature = await upload(
      tokens.doctor,
      'bad.pdf',
      'application/pdf',
      Buffer.from('plain text')
    );
    const mismatchedMime = await upload(tokens.doctor, 'bad.pdf', 'image/png', pdf);
    const mismatchedExtension = await upload(tokens.doctor, 'bad.txt', 'application/pdf', pdf);
    assert.strictEqual(invalidSignature.statusCode, 400);
    assert.strictEqual(mismatchedMime.statusCode, 400);
    assert.strictEqual(mismatchedExtension.statusCode, 400);
    assert.ok(auditLogs.some((audit) =>
      audit.action === 'VAULT_DOCUMENT_UPLOAD_FAILED' &&
      audit.outcome === 'FAILURE'
    ));
  });

  await test('path-like filenames cannot affect storage paths and files over 5 MiB are rejected', async () => {
    const malicious = await upload(tokens.doctor, '../outside.pdf', 'application/pdf', pdf);
    const oversized = await upload(
      tokens.doctor,
      'large.pdf',
      'application/pdf',
      Buffer.alloc(5 * 1024 * 1024 + 1, 0x41)
    );
    assert.strictEqual(malicious.statusCode, 201);
    assert.strictEqual(malicious.body.data.document.originalFilename, 'outside.pdf');
    const storedNames = (await fs.promises.readdir(storageDirectory))
      .filter((name) => name !== '.staging');
    assert.ok(storedNames.every((name) => /^[a-f0-9]{64}$/.test(name)));
    assert.strictEqual(oversized.statusCode, 413);
  });

  await test('download streams only owned files with safe headers', async () => {
    const uploaded = await upload(tokens.doctor, 'download.pdf', 'application/pdf', pdf);
    const id = uploaded.body.data.document._id;
    const result = await request('GET', `/api/vault/documents/${id}/download`, {
      token: tokens.doctor
    });
    assert.strictEqual(result.statusCode, 200);
    assert.deepStrictEqual(result.raw, pdf);
    assert.strictEqual(result.headers['content-type'], 'application/pdf');
    assert.match(result.headers['content-disposition'], /attachment;/);
    assert.strictEqual(result.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(result.headers['cache-control'], 'no-store');
    assert.ok(auditLogs.some((audit) =>
      audit.action === 'VAULT_DOCUMENT_DOWNLOADED' &&
      String(audit.resourceId) === id
    ));

    const otherOwner = await request('GET', `/api/vault/documents/${id}/download`, {
      token: tokens.otherDoctor
    });
    assert.strictEqual(otherOwner.statusCode, 404);
    const otherDelete = await request('DELETE', `/api/vault/documents/${id}`, {
      token: tokens.otherDoctor
    });
    assert.strictEqual(otherDelete.statusCode, 404);
    assert.strictEqual(documents.get(id).status, 'ACTIVE');
    assert.ok(auditLogs.some((audit) =>
      audit.action === 'VAULT_ACCESS_DENIED' &&
      String(audit.resourceId) === id
    ));
  });

  await test('delete soft-deletes an owned document and blocks later download/list access', async () => {
    const uploaded = await upload(tokens.doctor, 'delete.pdf', 'application/pdf', pdf);
    const id = uploaded.body.data.document._id;
    const result = await request('DELETE', `/api/vault/documents/${id}`, {
      token: tokens.doctor
    });
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.data.document.status, 'DELETED');
    assert.ok(auditLogs.some((audit) =>
      audit.action === 'VAULT_DOCUMENT_DELETED' &&
      String(audit.resourceId) === id
    ));
    const downloaded = await request('GET', `/api/vault/documents/${id}/download`, {
      token: tokens.doctor
    });
    assert.strictEqual(downloaded.statusCode, 404);
    assert.ok(await fs.promises.access(path.join(storageDirectory, documents.get(id).storageKey))
      .then(() => true, () => false));
  });

  await test('transaction-unavailable mutations fail closed', async () => {
    const before = documents.size;
    const beforeFiles = await fileCount();
    setTopology('Single');
    const uploadResult = await upload(tokens.doctor, 'standalone.pdf', 'application/pdf', pdf);
    assert.strictEqual(uploadResult.statusCode, 503);
    assert.strictEqual(documents.size, before);
    const document = addDocument(doctor);
    const deleteResult = await request('DELETE', `/api/vault/documents/${document._id}`, {
      token: tokens.doctor
    });
    assert.strictEqual(deleteResult.statusCode, 503);
    assert.strictEqual(documents.get(idOf(document._id)).status, 'ACTIVE');
    assert.strictEqual(await fileCount(), beforeFiles);
    setTopology('ReplicaSetWithPrimary');
  });

  await test('metadata or success-audit failures clean up uploaded files', async () => {
    const beforeCount = await fileCount();
    const beforeDocuments = documents.size;
    failDocumentSave = true;
    const metadataFailure = await upload(tokens.doctor, 'db-failure.pdf', 'application/pdf', pdf);
    failDocumentSave = false;
    assert.strictEqual(metadataFailure.statusCode, 500);
    assert.strictEqual(await fileCount(), beforeCount);
    assert.strictEqual(documents.size, beforeDocuments);

    failAuditAction = 'VAULT_DOCUMENT_UPLOADED';
    const auditFailure = await upload(tokens.doctor, 'audit-failure.pdf', 'application/pdf', pdf);
    failAuditAction = null;
    assert.strictEqual(auditFailure.statusCode, 500);
    assert.strictEqual(await fileCount(), beforeCount);
    assert.strictEqual(documents.size, beforeDocuments);

    commitThenThrow = true;
    const uncertainCommit = await upload(tokens.doctor, 'committed.pdf', 'application/pdf', pdf);
    assert.strictEqual(uncertainCommit.statusCode, 201);
    assert.strictEqual(documents.size, beforeDocuments + 1);
    assert.strictEqual(await fileCount(), beforeCount + 1);
  });

  await test('list operation fails closed when its success audit cannot be saved', async () => {
    failAuditAction = 'VAULT_DOCUMENTS_LISTED';
    const result = await request('GET', '/api/vault/documents', { token: tokens.doctor });
    failAuditAction = null;
    assert.strictEqual(result.statusCode, 500);
    assert.strictEqual(result.body.success, false);
  });

  await test('model rejects unsupported MIME types, invalid storage keys, and oversized metadata', async () => {
    const invalidMime = new DocumentVault({
      ownerDoctorId: doctor._id,
      uploadedBy: doctorUser._id,
      originalFilename: 'bad.svg',
      storageKey: cryptoKey(),
      mimeType: 'image/svg+xml',
      fileSize: 1
    });
    const invalidKey = new DocumentVault({
      ownerDoctorId: doctor._id,
      uploadedBy: doctorUser._id,
      originalFilename: 'bad.pdf',
      storageKey: '../bad',
      mimeType: 'application/pdf',
      fileSize: 6 * 1024 * 1024
    });
    assert.ok((await invalidMime.validate().then(() => null, (error) => error)));
    assert.ok((await invalidKey.validate().then(() => null, (error) => error)));
  });

  console.log(`\nVault tests: ${passed} passed, ${failed} failed.`);
};

main()
  .catch((error) => {
    failed++;
    console.error('Vault test setup failed.', error);
  })
  .finally(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    restoreMocks();
    await fs.promises.rm(storageDirectory, { recursive: true, force: true });
    if (failed > 0) process.exitCode = 1;
  });
