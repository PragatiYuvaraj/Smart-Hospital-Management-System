'use strict';

const assert = require('assert');
const http = require('http');
const mongoose = require('mongoose');
const app = require('../src/app');
const AuditLog = require('../src/models/AuditLog');
const Conversation = require('../src/models/Conversation');
const Doctor = require('../src/models/Doctor');
const DoctorAssignment = require('../src/models/DoctorAssignment');
const Message = require('../src/models/Message');
const Patient = require('../src/models/Patient');
const User = require('../src/models/User');
const generateToken = require('../src/utils/generateToken');

const users = new Map();
const patients = new Map();
const doctors = new Map();
const assignments = new Map();
const conversations = new Map();
const messages = new Map();
const auditLogs = [];
const transactionEvents = [];
const sessionWrites = [];
let failAuditAction = null;
let passed = 0;
let failed = 0;
let server;

const originals = {
  userFindById: User.findById,
  patientFindById: Patient.findById,
  patientFindOne: Patient.findOne,
  doctorFindById: Doctor.findById,
  doctorFindOne: Doctor.findOne,
  assignmentFind: DoctorAssignment.find,
  assignmentFindOne: DoctorAssignment.findOne,
  conversationFind: Conversation.find,
  conversationFindById: Conversation.findById,
  conversationFindOne: Conversation.findOne,
  conversationCountDocuments: Conversation.countDocuments,
  conversationSave: Conversation.prototype.save,
  messageFind: Message.find,
  messageFindOne: Message.findOne,
  messageCountDocuments: Message.countDocuments,
  messageSave: Message.prototype.save,
  auditSave: AuditLog.prototype.save,
  readyState: Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState'),
  client: Object.getOwnPropertyDescriptor(mongoose.connection, 'client'),
  transaction: Object.getOwnPropertyDescriptor(mongoose.connection, 'transaction')
};

const idOf = (value) => String(value);

const copyRecord = (record) => ({ ...record });

const matchesValue = (actual, expected) => {
  if (expected && typeof expected === 'object' && !(expected instanceof Date) &&
      !(expected instanceof mongoose.Types.ObjectId)) {
    if (expected.$in) {
      return expected.$in.some((candidate) => idOf(actual) === idOf(candidate));
    }
    return false;
  }
  return idOf(actual) === idOf(expected);
};

const matches = (record, filter = {}) =>
  Object.entries(filter).every(([field, expected]) =>
    matchesValue(record[field], expected)
  );

const sortRows = (rows, sort) => {
  if (!sort) return rows;
  return rows.sort((left, right) => {
    for (const [field, direction] of Object.entries(sort)) {
      const a = left[field] instanceof Date ? left[field].getTime() : String(left[field]);
      const b = right[field] instanceof Date ? right[field].getTime() : String(right[field]);
      if (a < b) return direction === -1 ? 1 : -1;
      if (a > b) return direction === -1 ? -1 : 1;
    }
    return 0;
  });
};

const makeQuery = (getter, Model, isList = false) => {
  let sort = null;
  let skip = 0;
  let limit = Number.MAX_SAFE_INTEGER;
  let asLean = false;
  const query = {
    session(session) {
      if (session) sessionWrites.push(session);
      return this;
    },
    select() {
      return this;
    },
    sort(value) {
      sort = value;
      return this;
    },
    skip(value) {
      skip = value;
      return this;
    },
    limit(value) {
      limit = value;
      return this;
    },
    lean() {
      asLean = true;
      return Promise.resolve(resolve());
    },
    then(resolvePromise, rejectPromise) {
      return Promise.resolve(resolve()).then(resolvePromise, rejectPromise);
    }
  };

  const resolve = () => {
    const source = getter();
    const rows = isList
      ? sortRows(source.slice(), sort).slice(skip, skip + limit)
      : source ? [source] : [];
    if (asLean || isList) {
      const plain = rows.map(copyRecord);
      return isList ? plain : plain[0] || null;
    }
    const hydrated = rows.map((row) => new Model(copyRecord(row)));
    return isList ? hydrated : hydrated[0] || null;
  };
  return query;
};

const snapshotMap = (map) =>
  new Map(Array.from(map, ([key, value]) => [key, copyRecord(value)]));

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
      const previous = {
        conversations: snapshotMap(conversations),
        messages: snapshotMap(messages),
        auditLength: auditLogs.length
      };
      const session = { mockedTransaction: true };
      try {
        return await operation(session);
      } catch (error) {
        conversations.clear();
        for (const [key, value] of previous.conversations) conversations.set(key, value);
        messages.clear();
        for (const [key, value] of previous.messages) messages.set(key, value);
        auditLogs.splice(previous.auditLength);
        throw error;
      }
    }
  });
};

const setupMocks = () => {
  setTopology('ReplicaSetWithPrimary');

  User.findById = (id) => makeQuery(
    () => users.get(idOf(id)) || null,
    User
  );
  Patient.findById = (id) => makeQuery(
    () => patients.get(idOf(id)) || null,
    Patient
  );
  Patient.findOne = (filter) => makeQuery(
    () => Array.from(patients.values()).find((patient) => matches(patient, filter)) || null,
    Patient
  );
  Doctor.findById = (id) => makeQuery(
    () => doctors.get(idOf(id)) || null,
    Doctor
  );
  Doctor.findOne = (filter) => makeQuery(
    () => Array.from(doctors.values()).find((doctor) => matches(doctor, filter)) || null,
    Doctor
  );
  DoctorAssignment.findOne = (filter) => makeQuery(
    () => Array.from(assignments.values()).find((assignment) => matches(assignment, filter)) || null,
    DoctorAssignment
  );
  DoctorAssignment.find = (filter) => makeQuery(
    () => Array.from(assignments.values()).filter((assignment) => matches(assignment, filter)),
    DoctorAssignment,
    true
  );

  Conversation.findById = (id) => makeQuery(
    () => conversations.get(idOf(id)) || null,
    Conversation
  );
  Conversation.findOne = (filter) => makeQuery(
    () => Array.from(conversations.values()).find((conversation) => matches(conversation, filter)) || null,
    Conversation
  );
  Conversation.find = (filter) => makeQuery(
    () => Array.from(conversations.values()).filter((conversation) => matches(conversation, filter)),
    Conversation,
    true
  );
  Conversation.countDocuments = async (filter) =>
    Array.from(conversations.values()).filter((conversation) => matches(conversation, filter)).length;
  Conversation.prototype.save = async function (options = {}) {
    if (!this._id) this._id = new mongoose.Types.ObjectId();
    const now = new Date();
    this.createdAt = this.createdAt || now;
    this.updatedAt = now;
    if (options.session) {
      sessionWrites.push(options.session);
      transactionEvents.push({
        kind: 'conversation',
        resourceId: idOf(this._id),
        session: options.session
      });
    }
    conversations.set(idOf(this._id), this.toObject());
    return this;
  };

  Message.findOne = (filter) => makeQuery(
    () => Array.from(messages.values()).find((message) => matches(message, filter)) || null,
    Message
  );
  Message.find = (filter) => makeQuery(
    () => Array.from(messages.values()).filter((message) => matches(message, filter)),
    Message,
    true
  );
  Message.countDocuments = async (filter) =>
    Array.from(messages.values()).filter((message) => matches(message, filter)).length;
  Message.prototype.save = async function (options = {}) {
    if (!this._id) this._id = new mongoose.Types.ObjectId();
    this.createdAt = this.createdAt || new Date();
    if (options.session) {
      sessionWrites.push(options.session);
      transactionEvents.push({
        kind: 'message',
        resourceId: idOf(this._id),
        session: options.session
      });
    }
    messages.set(idOf(this._id), this.toObject());
    return this;
  };

  AuditLog.prototype.save = async function (options = {}) {
    if (failAuditAction === this.action) {
      throw new Error('Simulated audit persistence failure');
    }
    if (options.session) sessionWrites.push(options.session);
    const audit = this.toObject();
    if (options.session) {
      transactionEvents.push({
        kind: 'audit',
        action: this.action,
        resourceId: idOf(this.resourceId),
        session: options.session
      });
    }
    auditLogs.push(audit);
    return this;
  };
};

const restoreMocks = () => {
  User.findById = originals.userFindById;
  Patient.findById = originals.patientFindById;
  Patient.findOne = originals.patientFindOne;
  Doctor.findById = originals.doctorFindById;
  Doctor.findOne = originals.doctorFindOne;
  DoctorAssignment.find = originals.assignmentFind;
  DoctorAssignment.findOne = originals.assignmentFindOne;
  Conversation.find = originals.conversationFind;
  Conversation.findById = originals.conversationFindById;
  Conversation.findOne = originals.conversationFindOne;
  Conversation.countDocuments = originals.conversationCountDocuments;
  Conversation.prototype.save = originals.conversationSave;
  Message.find = originals.messageFind;
  Message.findOne = originals.messageFindOne;
  Message.countDocuments = originals.messageCountDocuments;
  Message.prototype.save = originals.messageSave;
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
};

const request = (method, path, { token, body } = {}) =>
  new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: server.address().port,
        path,
        method,
        headers: {
          ...(payload !== null
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
              }
            : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch (_) {
            // Non-JSON responses are represented as null in this test helper.
          }
          resolve({ statusCode: res.statusCode, body: json, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });

const assertTest = (condition, description) => {
  if (condition) {
    passed++;
    console.log(`  PASS: ${description}`);
  } else {
    failed++;
    console.error(`  FAIL: ${description}`);
  }
};

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

const makeUser = (role, name, permissions = []) => {
  const user = {
    _id: new mongoose.Types.ObjectId(),
    name,
    email: `${name.toLowerCase().replace(/[^a-z]/g, '')}@example.test`,
    role,
    permissions,
    status: 'ACTIVE'
  };
  users.set(idOf(user._id), user);
  return user;
};

const makePatient = (user, name) => {
  const patient = {
    _id: new mongoose.Types.ObjectId(),
    userId: user._id,
    name,
    patientNumber: `PAT-${name}`,
    status: 'ACTIVE'
  };
  patients.set(idOf(patient._id), patient);
  return patient;
};

const makeDoctor = (user, name) => {
  const doctor = {
    _id: new mongoose.Types.ObjectId(),
    userId: user._id,
    name,
    specialization: 'General Medicine',
    status: 'ACTIVE'
  };
  doctors.set(idOf(doctor._id), doctor);
  return doctor;
};

const makeAssignment = (doctor, patient, status = 'ACTIVE') => {
  const assignment = {
    _id: new mongoose.Types.ObjectId(),
    doctorId: doctor._id,
    patientId: patient._id,
    assignmentType: 'TREATING',
    status
  };
  assignments.set(idOf(assignment._id), assignment);
  return assignment;
};

const run = async () => {
  setupMocks();
  const patientUser = makeUser('PATIENT', 'Alice Patient');
  const patient = makePatient(patientUser, 'Alice Patient');
  const otherPatientUser = makeUser('PATIENT', 'Bob Patient');
  const otherPatient = makePatient(otherPatientUser, 'Bob Patient');
  const doctorUser = makeUser('DOCTOR', 'Dr Treating');
  const doctor = makeDoctor(doctorUser, 'Dr Treating');
  const newDoctorUser = makeUser('DOCTOR', 'Dr New');
  const newDoctor = makeDoctor(newDoctorUser, 'Dr New');
  const unassignedDoctorUser = makeUser('DOCTOR', 'Dr Unassigned');
  makeDoctor(unassignedDoctorUser, 'Dr Unassigned');
  const dutyDoctorUser = makeUser('DOCTOR', 'Dr Duty', ['DUTY_DOCTOR']);
  makeDoctor(dutyDoctorUser, 'Dr Duty');
  const pharmacyUser = makeUser('PHARMACY', 'Pharmacy User');
  makeAssignment(doctor, patient);
  makeAssignment(newDoctor, otherPatient);

  const tokens = {
    patient: generateToken(patientUser),
    otherPatient: generateToken(otherPatientUser),
    doctor: generateToken(doctorUser),
    newDoctor: generateToken(newDoctorUser),
    unassignedDoctor: generateToken(unassignedDoctorUser),
    dutyDoctor: generateToken(dutyDoctorUser),
    pharmacy: generateToken(pharmacyUser)
  };

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  let patientConversation;
  let otherConversation;
  let patientMessage;
  let doctorReply;
  let patientCUser;
  let patientC;

  try {
    console.log('\n--- Messaging model validation ---');
    const invalidConversation = new Conversation({});
    assertTest(Boolean(invalidConversation.validateSync()?.errors.patientId), 'Conversation requires a patient reference');
    assertTest(Boolean(invalidConversation.validateSync()?.errors.doctorId), 'Conversation requires a doctor reference');
    const invalidMessage = new Message({});
    assertTest(Boolean(invalidMessage.validateSync()?.errors.conversationId), 'Message requires a conversation reference');
    assertTest(Boolean(invalidMessage.validateSync()?.errors.senderId), 'Message requires a sender reference');
    assertTest(Boolean(invalidMessage.validateSync()?.errors.recipientId), 'Message requires a recipient reference');
    assertTest(Boolean(invalidMessage.validateSync()?.errors.body), 'Message requires a body');
    const pairIndex = Conversation.schema.indexes().find(
      ([fields, options]) =>
        fields.patientId === 1 && fields.doctorId === 1 && options.unique === true
    );
    assertTest(Boolean(pairIndex), 'Conversation schema declares a unique patient-doctor pair index');
    const invalidLength = new Message({
      conversationId: new mongoose.Types.ObjectId(),
      senderId: patientUser._id,
      recipientId: doctorUser._id,
      body: 'x'.repeat(4001)
    });
    assertTest(Boolean(invalidLength.validateSync()?.errors.body), 'Message schema enforces the maximum body length');
    const validMessage = new Message({
      conversationId: new mongoose.Types.ObjectId(),
      senderId: patientUser._id,
      recipientId: doctorUser._id,
      body: 'Hello'
    });
    assertTest(!validMessage.validateSync(), 'Valid message passes schema validation');

    console.log('\n--- Conversation creation and access ---');
    await test('patient creates a conversation with their active treating doctor', async () => {
      const response = await request('POST', '/api/conversations', { token: tokens.patient });
      assert.strictEqual(response.statusCode, 201);
      patientConversation = response.body.data.conversation;
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.conversation.participants.patient.id, idOf(patient._id));
      assert.strictEqual(response.body.data.conversation.participants.doctor.id, idOf(doctor._id));
      assert.strictEqual(conversations.size, 1);
      assert.strictEqual(
        auditLogs.some((event) =>
          event.action === 'CONVERSATION_CREATED' &&
          idOf(event.actorId) === idOf(patientUser._id) &&
          event.outcome === 'SUCCESS'
        ),
        true
      );
    });

    await test('repeated creation retrieves the unique patient-doctor conversation', async () => {
      const response = await request('POST', '/api/conversations', { token: tokens.patient });
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.body.data.conversation._id, patientConversation._id);
      assert.strictEqual(conversations.size, 1);
    });

    await test('patient cannot supply another patient identity', async () => {
      const response = await request('POST', '/api/conversations', {
        token: tokens.patient,
        body: { patientId: idOf(otherPatient._id) }
      });
      assert.strictEqual(response.statusCode, 400);
      assert.strictEqual(response.body.success, false);
      assert.strictEqual(
        auditLogs.some((event) =>
          event.action === 'MESSAGING_ACCESS_DENIED' &&
          event.outcome === 'FAILURE' &&
          event.accessContext.accessType === 'IDENTITY_FIELDS_REJECTED'
        ),
        true
      );
    });

    await test('doctor retrieves the same conversation only with an active treating assignment', async () => {
      const response = await request('POST', '/api/conversations', {
        token: tokens.doctor,
        body: { patientId: idOf(patient._id) }
      });
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.body.data.conversation._id, patientConversation._id);
      const denied = await request('POST', '/api/conversations', {
        token: tokens.unassignedDoctor,
        body: { patientId: idOf(patient._id) }
      });
      assert.strictEqual(denied.statusCode, 403);
    });

    await test('DUTY_DOCTOR without an active treating assignment is denied', async () => {
      const response = await request('POST', '/api/conversations', {
        token: tokens.dutyDoctor,
        body: { patientId: idOf(patient._id) }
      });
      const history = await request(
        'GET',
        `/api/conversations/${patientConversation._id}/messages`,
        { token: tokens.dutyDoctor }
      );
      assert.strictEqual(response.statusCode, 403);
      assert.strictEqual(history.statusCode, 403);
      assert.strictEqual(conversations.size, 1);
    });

    await test('pharmacy is denied on every messaging endpoint', async () => {
      const responses = await Promise.all([
        request('GET', '/api/conversations', { token: tokens.pharmacy }),
        request('POST', '/api/conversations', { token: tokens.pharmacy, body: {} }),
        request('GET', `/api/conversations/${patientConversation._id}/messages`, { token: tokens.pharmacy }),
        request('POST', `/api/conversations/${patientConversation._id}/messages`, {
          token: tokens.pharmacy,
          body: { body: 'Not allowed' }
        }),
        request('PATCH', `/api/conversations/${patientConversation._id}/messages/${new mongoose.Types.ObjectId()}/read`, {
          token: tokens.pharmacy
        })
      ]);
      assert.deepStrictEqual(responses.map((response) => response.statusCode), [403, 403, 403, 403, 403]);
      assert.strictEqual(
        auditLogs.some((event) =>
          event.action === 'MESSAGING_ACCESS_DENIED' &&
          idOf(event.actorId) === idOf(pharmacyUser._id) &&
          event.outcome === 'FAILURE'
        ),
        true
      );
    });

    console.log('\n--- Message sending, history, and read status ---');
    await test('message sender and recipient are derived from the authenticated conversation participants', async () => {
      const response = await request('POST', `/api/conversations/${patientConversation._id}/messages`, {
        token: tokens.patient,
        body: { body: '  Hello, doctor.  ' }
      });
      assert.strictEqual(response.statusCode, 201);
      patientMessage = response.body.data.message;
      assert.strictEqual(patientMessage.senderId, idOf(patientUser._id));
      assert.strictEqual(patientMessage.recipientId, idOf(doctorUser._id));
      assert.strictEqual(patientMessage.body, 'Hello, doctor.');
      assert.strictEqual(patientMessage.status, 'SENT');
      assert.strictEqual(patientMessage.readAt, null);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(auditLogs[auditLogs.length - 1], 'body'), false);
    });

    await test('client-supplied senderId or recipientId is rejected', async () => {
      const senderSpoof = await request('POST', `/api/conversations/${patientConversation._id}/messages`, {
        token: tokens.patient,
        body: { body: 'Spoof', senderId: idOf(doctorUser._id) }
      });
      const recipientSpoof = await request('POST', `/api/conversations/${patientConversation._id}/messages`, {
        token: tokens.patient,
        body: { body: 'Spoof', recipientId: idOf(otherPatientUser._id) }
      });
      assert.strictEqual(senderSpoof.statusCode, 400);
      assert.strictEqual(recipientSpoof.statusCode, 400);
      assert.strictEqual(messages.size, 1);
    });

    await test('empty, non-string, and oversized message bodies are rejected', async () => {
      const empty = await request('POST', `/api/conversations/${patientConversation._id}/messages`, {
        token: tokens.patient,
        body: { body: '   ' }
      });
      const nonString = await request('POST', `/api/conversations/${patientConversation._id}/messages`, {
        token: tokens.patient,
        body: { body: 42 }
      });
      const oversized = await request('POST', `/api/conversations/${patientConversation._id}/messages`, {
        token: tokens.patient,
        body: { body: 'x'.repeat(4001) }
      });
      const unicodeOversized = await request(
        'POST',
        `/api/conversations/${patientConversation._id}/messages`,
        { token: tokens.patient, body: { body: '\u{1F600}'.repeat(2001) } }
      );
      assert.deepStrictEqual(
        [empty.statusCode, nonString.statusCode, oversized.statusCode, unicodeOversized.statusCode],
        [400, 400, 400, 400]
      );
      assert.strictEqual(messages.size, 1);
    });

    await test('doctor can reply and message history is chronological and paginated', async () => {
      const sent = await request('POST', `/api/conversations/${patientConversation._id}/messages`, {
        token: tokens.doctor,
        body: { body: 'Please follow up tomorrow.' }
      });
      assert.strictEqual(sent.statusCode, 201);
      doctorReply = sent.body.data.message;
      assert.strictEqual(doctorReply.senderId, idOf(doctorUser._id));
      assert.strictEqual(doctorReply.recipientId, idOf(patientUser._id));

      const firstPage = await request(
        'GET',
        `/api/conversations/${patientConversation._id}/messages?page=1&limit=1`,
        { token: tokens.patient }
      );
      assert.strictEqual(firstPage.statusCode, 200);
      assert.strictEqual(firstPage.body.data.total, 2);
      assert.strictEqual(firstPage.body.data.messages.length, 1);
      assert.strictEqual(firstPage.body.data.messages[0]._id, patientMessage._id);
      assert.strictEqual(firstPage.body.data.totalPages, 2);
      assert.strictEqual(
        auditLogs.some((event) =>
          event.action === 'MESSAGES_ACCESSED' &&
          idOf(event.resourceId) === patientConversation._id
        ),
        true
      );
    });

    await test('only the recipient can mark a message read; repeated reads are idempotent', async () => {
      const senderAttempt = await request(
        'PATCH',
        `/api/conversations/${patientConversation._id}/messages/${patientMessage._id}/read`,
        { token: tokens.patient }
      );
      assert.strictEqual(senderAttempt.statusCode, 403);

      failAuditAction = 'MESSAGE_READ';
      const failedRead = await request(
        'PATCH',
        `/api/conversations/${patientConversation._id}/messages/${doctorReply._id}/read`,
        { token: tokens.patient }
      );
      failAuditAction = null;
      assert.strictEqual(failedRead.statusCode, 500);
      assert.strictEqual(
        messages.get(doctorReply._id).status,
        'SENT'
      );

      const firstRead = await request(
        'PATCH',
        `/api/conversations/${patientConversation._id}/messages/${doctorReply._id}/read`,
        { token: tokens.patient }
      );
      assert.strictEqual(firstRead.statusCode, 200);
      assert.strictEqual(firstRead.body.data.message.status, 'READ');
      const firstReadAt = firstRead.body.data.message.readAt;

      const repeatedRead = await request(
        'PATCH',
        `/api/conversations/${patientConversation._id}/messages/${doctorReply._id}/read`,
        { token: tokens.patient }
      );
      assert.strictEqual(repeatedRead.statusCode, 200);
      assert.strictEqual(repeatedRead.body.data.message.readAt, firstReadAt);
    });

    await test('message ID from another conversation cannot be read in this conversation', async () => {
      const otherCreated = await request('POST', '/api/conversations', {
        token: tokens.otherPatient
      });
      assert.strictEqual(otherCreated.statusCode, 201);
      otherConversation = otherCreated.body.data.conversation;
      const otherSent = await request('POST', `/api/conversations/${otherConversation._id}/messages`, {
        token: tokens.otherPatient,
        body: { body: 'Separate conversation' }
      });
      assert.strictEqual(otherSent.statusCode, 201);
      const mismatch = await request(
        'PATCH',
        `/api/conversations/${patientConversation._id}/messages/${otherSent.body.data.message._id}/read`,
        { token: tokens.doctor }
      );
      assert.strictEqual(mismatch.statusCode, 404);
    });

    await test('patient and doctor conversation lists are self/assignment scoped and paginated', async () => {
      const patientList = await request('GET', '/api/conversations?page=1&limit=1', {
        token: tokens.patient
      });
      assert.strictEqual(patientList.statusCode, 200);
      assert.strictEqual(patientList.body.data.total, 1);
      assert.strictEqual(patientList.body.data.conversations.length, 1);
      assert.strictEqual(patientList.body.data.conversations[0]._id, patientConversation._id);
      assert.strictEqual(
        Object.keys(patientList.body.data.conversations[0].participants.patient).sort().join(','),
        'id,name,role'
      );
      assert.ok(patientList.body.data.conversations[0].latestMessage);

      const doctorList = await request('GET', '/api/conversations?page=1&limit=10', {
        token: tokens.doctor
      });
      assert.strictEqual(doctorList.statusCode, 200);
      assert.strictEqual(doctorList.body.data.total, 1);
      assert.strictEqual(doctorList.body.data.conversations[0]._id, patientConversation._id);

      const invalidPage = await request('GET', '/api/conversations?page=0&limit=10', {
        token: tokens.patient
      });
      assert.strictEqual(invalidPage.statusCode, 400);
    });

    await test('another patient and an unassigned doctor cannot retrieve conversation history', async () => {
      const patientDenied = await request(
        'GET',
        `/api/conversations/${patientConversation._id}/messages`,
        { token: tokens.otherPatient }
      );
      const doctorDenied = await request(
        'GET',
        `/api/conversations/${otherConversation._id}/messages`,
        { token: tokens.unassignedDoctor }
      );
      assert.strictEqual(patientDenied.statusCode, 403);
      assert.strictEqual(doctorDenied.statusCode, 403);
    });

    console.log('\n--- Reassignment, transaction, and audit behavior ---');
    await test('previous doctor loses access after reassignment while patient retains history', async () => {
      const priorAssignment = Array.from(assignments.values()).find(
        (assignment) =>
          idOf(assignment.patientId) === idOf(patient._id) &&
          idOf(assignment.doctorId) === idOf(doctor._id) &&
          assignment.status === 'ACTIVE'
      );
      priorAssignment.status = 'CLOSED';
      makeAssignment(newDoctor, patient);

      const oldDoctorAccess = await request(
        'GET',
        `/api/conversations/${patientConversation._id}/messages`,
        { token: tokens.doctor }
      );
      assert.strictEqual(oldDoctorAccess.statusCode, 403);

      const patientHistory = await request(
        'GET',
        `/api/conversations/${patientConversation._id}/messages`,
        { token: tokens.patient }
      );
      assert.strictEqual(patientHistory.statusCode, 200);
      assert.strictEqual(patientHistory.body.data.total, 2);

      const newDoctorCreate = await request('POST', '/api/conversations', {
        token: tokens.newDoctor,
        body: { patientId: idOf(patient._id) }
      });
      assert.strictEqual(newDoctorCreate.statusCode, 201);
      assert.notStrictEqual(newDoctorCreate.body.data.conversation._id, patientConversation._id);
      assert.strictEqual(conversations.size, 3);

      const newDoctorOldHistory = await request(
        'GET',
        `/api/conversations/${patientConversation._id}/messages`,
        { token: tokens.newDoctor }
      );
      assert.strictEqual(newDoctorOldHistory.statusCode, 403);

      const patientList = await request('GET', '/api/conversations?page=1&limit=10', {
        token: tokens.patient
      });
      assert.strictEqual(patientList.body.data.total, 2);
      assert.ok(patientList.body.data.conversations.some(
        (item) => item._id === patientConversation._id
      ));
      assert.ok(patientList.body.data.conversations.some(
        (item) => item._id === newDoctorCreate.body.data.conversation._id
      ));
    });

    await test('transaction-dependent operations fail closed on standalone topology', async () => {
      patientCUser = makeUser('PATIENT', 'Charlie Patient');
      patientC = makePatient(patientCUser, 'Charlie Patient');
      makeAssignment(doctor, patientC);
      const beforeMessages = messages.size;
      const beforeConversations = conversations.size;
      setTopology('Single');
      const send = await request('POST', `/api/conversations/${patientConversation._id}/messages`, {
        token: tokens.patient,
        body: { body: 'Must not persist' }
      });
      const create = await request('POST', '/api/conversations', {
        token: tokens.newDoctor,
        body: { patientId: idOf(patient._id) }
      });
      const newConversation = await request('POST', '/api/conversations', {
        token: generateToken(patientCUser)
      });
      const read = await request(
        'PATCH',
        `/api/conversations/${patientConversation._id}/messages/${doctorReply._id}/read`,
        { token: tokens.patient }
      );
      assert.deepStrictEqual(
        [send.statusCode, create.statusCode, newConversation.statusCode, read.statusCode],
        [503, 503, 503, 503]
      );
      assert.strictEqual(messages.size, beforeMessages);
      assert.strictEqual(conversations.size, beforeConversations);
      setTopology('ReplicaSetWithPrimary');
    });

    await test('audit failure rolls back a sent message and conversation timestamp', async () => {
      const beforeMessages = messages.size;
      const beforeAudits = auditLogs.length;
      const storedConversation = conversations.get(patientConversation._id);
      const beforeLastMessageAt = storedConversation.lastMessageAt;
      failAuditAction = 'MESSAGE_SENT';
      const response = await request('POST', `/api/conversations/${patientConversation._id}/messages`, {
        token: tokens.patient,
        body: { body: 'Audit must commit with this message.' }
      });
      failAuditAction = null;
      assert.strictEqual(response.statusCode, 500);
      assert.strictEqual(messages.size, beforeMessages);
      assert.strictEqual(auditLogs.length, beforeAudits);
      assert.strictEqual(
        conversations.get(patientConversation._id).lastMessageAt,
        beforeLastMessageAt
      );
    });

    await test('conversation creation rolls back when its audit write fails', async () => {
      const beforeConversations = conversations.size;
      failAuditAction = 'CONVERSATION_CREATED';
      const response = await request('POST', '/api/conversations', {
        token: generateToken(patientCUser)
      });
      failAuditAction = null;
      assert.strictEqual(response.statusCode, 500);
      assert.strictEqual(conversations.size, beforeConversations);
    });

    await test('audit events include outcome and IP attribution but never message content', async () => {
      const sentAudit = auditLogs.find((event) => event.action === 'MESSAGE_SENT');
      const deniedAudit = auditLogs.find(
        (event) => event.action === 'MESSAGING_ACCESS_DENIED'
      );
      assert.ok(sentAudit);
      assert.strictEqual(sentAudit.outcome, 'SUCCESS');
      assert.ok(sentAudit.ipAddress);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(sentAudit, 'body'), false);
      assert.ok(deniedAudit);
      assert.strictEqual(deniedAudit.outcome, 'FAILURE');
      assert.ok(deniedAudit.ipAddress);
      const messageWrite = transactionEvents.find(
        (event) => event.kind === 'message' && event.resourceId === idOf(patientMessage._id)
      );
      const messageAudit = transactionEvents.find(
        (event) => event.kind === 'audit' &&
          event.action === 'MESSAGE_SENT' &&
          event.resourceId === idOf(patientMessage._id)
      );
      assert.ok(messageWrite);
      assert.ok(messageAudit);
      assert.strictEqual(messageAudit.session, messageWrite.session);
      assert.ok(sessionWrites.some((session) => session.mockedTransaction));
      for (const action of [
        'CONVERSATION_CREATED',
        'CONVERSATIONS_ACCESSED',
        'MESSAGES_ACCESSED',
        'MESSAGE_READ'
      ]) {
        assert.ok(auditLogs.some((event) => event.action === action), `missing audit event ${action}`);
      }
    });
  } finally {
    failAuditAction = null;
    restoreMocks();
    if (server) await new Promise((resolve) => server.close(resolve));
  }

  console.log('\n------------------------------------------------------------');
  console.log(`MESSAGING ASSERTIONS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('Mocked Mongoose models and transactions; HTTP requests used an in-process Express server.');
  console.log('No live MongoDB deployment was used.');
  console.log('------------------------------------------------------------\n');
  if (failed > 0) process.exitCode = 1;
};

run().catch(async (error) => {
  console.error('Messaging test execution error:', error);
  restoreMocks();
  if (server) await new Promise((resolve) => server.close(resolve));
  process.exitCode = 1;
});
