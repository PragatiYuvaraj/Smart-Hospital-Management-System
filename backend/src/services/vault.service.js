'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const env = require('../config/env');
const Doctor = require('../models/Doctor');
const DocumentVault = require('../models/DocumentVault');
const { recordAudit } = require('./audit.service');

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_PAGE_SIZE = 100;
const MIME_EXTENSIONS = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg']
};
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TRANSACTION_TOPOLOGIES = new Set([
  'ReplicaSetWithPrimary',
  'ReplicaSetNoPrimary',
  'Sharded'
]);
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const REPOSITORY_ROOT = path.resolve(BACKEND_ROOT, '..');
const PUBLIC_ROOTS = [
  path.join(BACKEND_ROOT, 'public'),
  path.join(REPOSITORY_ROOT, 'frontend', 'public')
];

const createError = (statusCode, message, errors = []) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errors = errors;
  return error;
};

const createAccessError = (
  statusCode,
  message,
  { resourceType = 'DocumentVaultAccess', resourceId, accessType = 'UNAUTHORIZED' } = {}
) => {
  const error = createError(statusCode, message);
  error.auditDenied = true;
  error.auditResourceType = resourceType;
  error.auditResourceId = resourceId;
  error.auditAccessType = accessType;
  return error;
};

const isObjectId = (value) => {
  if (typeof value !== 'string' && !(value instanceof mongoose.Types.ObjectId)) {
    return false;
  }
  const asString = String(value);
  return mongoose.Types.ObjectId.isValid(asString) &&
    String(new mongoose.Types.ObjectId(asString)) === asString;
};

const isWithin = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative));
};

const configuredStorageRoot = () => {
  if (typeof env.VAULT_STORAGE_PATH !== 'string' || !env.VAULT_STORAGE_PATH.trim()) {
    throw createError(500, 'Private document storage is not configured.');
  }
  const configured = env.VAULT_STORAGE_PATH.trim();
  const root = path.isAbsolute(configured)
    ? path.resolve(configured)
    : path.resolve(BACKEND_ROOT, configured);
  if (
    (!path.isAbsolute(configured) && !isWithin(BACKEND_ROOT, root)) ||
    PUBLIC_ROOTS.some((publicRoot) => isWithin(path.resolve(publicRoot), root))
  ) {
    throw createError(500, 'Private document storage must be outside public directories.');
  }
  return root;
};

const getPrivateStorageRoot = async (createDirectories) => {
  const configuredRoot = configuredStorageRoot();
  if (createDirectories) {
    await fs.promises.mkdir(configuredRoot, { recursive: true, mode: 0o700 });
    const stagingDirectory = path.join(configuredRoot, '.staging');
    await fs.promises.mkdir(stagingDirectory, { recursive: true, mode: 0o700 });
    const stagingStat = await fs.promises.lstat(stagingDirectory);
    if (!stagingStat.isDirectory() || stagingStat.isSymbolicLink()) {
      throw createError(500, 'Private document staging storage is unavailable.');
    }
  }

  const realRoot = await fs.promises.realpath(configuredRoot);
  for (const publicRoot of PUBLIC_ROOTS) {
    try {
      const realPublicRoot = await fs.promises.realpath(publicRoot);
      if (isWithin(realPublicRoot, realRoot)) {
        throw createError(500, 'Private document storage must be outside public directories.');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return realRoot;
};

const getStorageFilePath = (storageKey, root) => {
  if (typeof storageKey !== 'string' || !/^[a-f0-9]{64}$/.test(storageKey)) {
    throw createError(500, 'Stored document reference is invalid.');
  }
  const filePath = path.resolve(root, storageKey);
  if (path.dirname(filePath) !== root) {
    throw createError(500, 'Stored document reference is invalid.');
  }
  return filePath;
};

const getRequestIp = (context) => {
  const ipAddress = context && context.ipAddress;
  return typeof ipAddress === 'string' && ipAddress.length <= 45
    ? ipAddress
    : undefined;
};

const recordVaultAudit = async (event, session) => {
  try {
    await recordAudit(event, session);
  } catch {
    const error = createError(
      500,
      'Vault audit could not be saved; the requested operation was not completed.'
    );
    throw error;
  }
};

const recordDeniedAccess = async (user, context, error) => {
  if (!user || !isObjectId(user._id)) throw error;
  await recordVaultAudit({
    actorId: user._id,
    action: 'VAULT_ACCESS_DENIED',
    resourceType: error.auditResourceType || 'DocumentVaultAccess',
    resourceId: isObjectId(error.auditResourceId)
      ? error.auditResourceId
      : user._id,
    accessType: error.auditAccessType || 'UNAUTHORIZED',
    outcome: 'FAILURE',
    ipAddress: getRequestIp(context)
  });
  throw error;
};

const denyAccess = async (user, context, message, accessType, resourceId) => {
  const error = createAccessError(403, message, {
    resourceType: resourceId ? 'DocumentVault' : 'DocumentVaultAccess',
    resourceId,
    accessType
  });
  return recordDeniedAccess(user, context, error);
};

const getAuthorizedDoctor = async (user, context = {}, knownDoctor) => {
  if (!user || !isObjectId(user._id)) {
    throw createError(401, 'Authentication required.');
  }
  if (user.role !== 'DOCTOR') {
    await denyAccess(user, context, 'Only doctors can access the document vault.', 'ROLE_DENIED');
  }
  if (!(user.permissions || []).includes('VAULT_ACCESS')) {
    await denyAccess(user, context, 'The VAULT_ACCESS permission is required.', 'VAULT_PERMISSION_REQUIRED');
  }

  const doctor = knownDoctor || await Doctor.findOne({ userId: user._id });
  if (
    !doctor ||
    doctor.status !== 'ACTIVE' ||
    String(doctor.userId) !== String(user._id)
  ) {
    await denyAccess(user, context, 'An active doctor profile is required for vault access.', 'DOCTOR_PROFILE_REQUIRED');
  }
  return doctor;
};

const authorizeDoctor = (user, context = {}) =>
  getAuthorizedDoctor(user, context);

const withSession = (query, session) =>
  session && query && typeof query.session === 'function'
    ? query.session(session)
    : query;

const supportsTransactions = () => {
  const connection = mongoose.connection;
  const topology = connection.client && connection.client.topology;
  const topologyType = topology && topology.description && topology.description.type;
  return connection.readyState === 1 &&
    typeof connection.transaction === 'function' &&
    TRANSACTION_TOPOLOGIES.has(topologyType);
};

const withRequiredTransaction = async (operation) => {
  if (!supportsTransactions()) {
    throw createError(
      503,
      'Vault metadata mutations require MongoDB replica-set or sharded transactions; no database changes were made.'
    );
  }
  return mongoose.connection.transaction(operation);
};

const recordOperationFailure = async (
  user,
  doctor,
  context,
  action,
  resourceType,
  resourceId,
  accessType
) => recordVaultAudit({
  actorId: user._id,
  action,
  resourceType,
  resourceId: isObjectId(resourceId) ? resourceId : doctor._id,
  accessType,
  outcome: 'FAILURE',
  ipAddress: getRequestIp(context)
});

const parsePagination = (query = {}) => {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw createError(400, 'Pagination query must be an object.');
  }
  const unsupported = Object.keys(query).filter((key) => !['page', 'limit'].includes(key));
  if (unsupported.length > 0) {
    throw createError(400, 'Only page and limit pagination parameters are supported.');
  }

  const parseValue = (value, defaultValue, field) => {
    if (value === undefined) return defaultValue;
    if (
      typeof value !== 'string' ||
      !/^[1-9]\d*$/.test(value) ||
      !Number.isSafeInteger(Number(value))
    ) {
      throw createError(400, `${field} must be a positive integer.`);
    }
    return Number(value);
  };
  const page = parseValue(query.page, 1, 'page');
  const limit = Math.min(parseValue(query.limit, 20, 'limit'), MAX_PAGE_SIZE);
  const skip = (page - 1) * limit;
  if (!Number.isSafeInteger(skip)) {
    throw createError(400, 'Pagination values are too large.');
  }
  return { page, limit, skip };
};

const toDocumentResponse = (document) => ({
  _id: String(document._id),
  originalFilename: document.originalFilename,
  mimeType: document.mimeType,
  fileSize: document.fileSize,
  uploadedAt: document.uploadedAt,
  status: document.status
});

const listDocuments = async (query, user, context = {}, knownDoctor) => {
  const doctor = await getAuthorizedDoctor(user, context, knownDoctor);
  const { page, limit, skip } = parsePagination(query);
  const filter = { ownerDoctorId: doctor._id, status: 'ACTIVE' };
  let documents;
  let total;
  try {
    [documents, total] = await Promise.all([
      DocumentVault.find(filter)
        .select('-storageKey')
        .sort({ uploadedAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      DocumentVault.countDocuments(filter)
    ]);
  } catch (error) {
    await recordOperationFailure(
      user,
      doctor,
      context,
      'VAULT_DOCUMENT_LIST_FAILED',
      'DocumentVaultList',
      doctor._id,
      'LIST_FAILED'
    );
    throw error;
  }

  await recordVaultAudit({
    actorId: user._id,
    action: 'VAULT_DOCUMENTS_LISTED',
    resourceType: 'DocumentVaultList',
    resourceId: doctor._id,
    accessType: 'OWNER_ONLY',
    ipAddress: getRequestIp(context)
  });
  return {
    documents: documents.map(toDocumentResponse),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  };
};

const sanitizeDisplayFilename = (filename) => {
  if (
    typeof filename !== 'string' ||
    filename.length === 0 ||
    filename.length > 255 ||
    /[\\/\\\x00-\x1f\x7f]/.test(filename)
  ) {
    throw createError(400, 'Document filename is invalid.');
  }
  const trimmed = filename.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') {
    throw createError(400, 'Document filename is invalid.');
  }
  return trimmed;
};

const detectMimeType = (buffer) => {
  if (
    buffer.length >= 33 &&
    buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) &&
    buffer.readUInt32BE(8) === 13 &&
    buffer.toString('ascii', 12, 16) === 'IHDR'
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff &&
    buffer[buffer.length - 2] === 0xff &&
    buffer[buffer.length - 1] === 0xd9
  ) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 5) === '%PDF-' &&
    buffer.subarray(Math.max(0, buffer.length - 1024)).includes(Buffer.from('%%EOF'))
  ) {
    return 'application/pdf';
  }
  return null;
};

const rejectUpload = async (user, doctor, context, statusCode, message, accessType) => {
  await recordOperationFailure(
    user,
    doctor,
    context,
    'VAULT_DOCUMENT_UPLOAD_FAILED',
    'Doctor',
    doctor._id,
    accessType
  );
  throw createError(statusCode, message);
};

const cleanupUploadFiles = async (paths) => {
  let firstError;
  for (const filePath of paths.filter(Boolean)) {
    try {
      await fs.promises.unlink(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT' && !firstError) firstError = error;
    }
  }
  if (firstError) throw firstError;
};

const uploadDocument = async (file, user, context = {}, knownDoctor) => {
  const doctor = await getAuthorizedDoctor(user, context, knownDoctor);
  if (!file || !Buffer.isBuffer(file.buffer)) {
    return rejectUpload(user, doctor, context, 400, 'A document file is required.', 'FILE_REQUIRED');
  }
  if (file.buffer.length === 0 || file.size !== file.buffer.length) {
    return rejectUpload(user, doctor, context, 400, 'Document file is invalid.', 'INVALID_FILE_SIZE');
  }
  if (file.buffer.length > MAX_FILE_SIZE) {
    return rejectUpload(user, doctor, context, 413, 'Document exceeds the 5 MB upload limit.', 'FILE_TOO_LARGE');
  }

  let originalFilename;
  try {
    originalFilename = sanitizeDisplayFilename(file.originalname);
  } catch (error) {
    await rejectUpload(user, doctor, context, 400, error.message, 'INVALID_FILENAME');
  }

  const detectedMimeType = detectMimeType(file.buffer);
  const declaredMimeType = file.mimetype;
  const extension = path.extname(originalFilename).toLowerCase();
  if (
    !detectedMimeType ||
    detectedMimeType !== declaredMimeType ||
    !MIME_EXTENSIONS[detectedMimeType] ||
    !MIME_EXTENSIONS[detectedMimeType].includes(extension)
  ) {
    return rejectUpload(
      user,
      doctor,
      context,
      400,
      'Document content, MIME type, and filename extension must match an allowed PDF, PNG, or JPEG format.',
      'FILE_TYPE_REJECTED'
    );
  }
  if (!supportsTransactions()) {
    return rejectUpload(
      user,
      doctor,
      context,
      503,
      'Vault metadata mutations require MongoDB replica-set or sharded transactions; no database changes were made.',
      'TRANSACTIONS_UNAVAILABLE'
    );
  }

  let stagingPath;
  let finalPath;
  let storageKey;
  let transactionAttempted = false;
  try {
    const storageRoot = await getPrivateStorageRoot(true);
    storageKey = crypto.randomBytes(32).toString('hex');
    stagingPath = path.join(storageRoot, '.staging', `${storageKey}.part`);
    finalPath = getStorageFilePath(storageKey, storageRoot);
    await fs.promises.writeFile(stagingPath, file.buffer, {
      flag: 'wx',
      mode: 0o600
    });
    await fs.promises.rename(stagingPath, finalPath);
    stagingPath = null;

    transactionAttempted = true;
    const document = await withRequiredTransaction(async (session) => {
      const metadata = new DocumentVault({
        ownerDoctorId: doctor._id,
        uploadedBy: user._id,
        originalFilename,
        storageKey,
        mimeType: detectedMimeType,
        fileSize: file.buffer.length,
        uploadedAt: new Date(),
        status: 'ACTIVE'
      });
      await metadata.save({ session });
      await recordVaultAudit({
        actorId: user._id,
        action: 'VAULT_DOCUMENT_UPLOADED',
        resourceType: 'DocumentVault',
        resourceId: metadata._id,
        accessType: 'OWNER_ONLY',
        ipAddress: getRequestIp(context)
      }, session);
      return metadata;
    });
    return toDocumentResponse(document);
  } catch (cause) {
    let cleanupError;
    let removeFinalFile = true;
    if (transactionAttempted && storageKey) {
      try {
        const committedDocument = await DocumentVault.findOne({ storageKey });
        if (committedDocument) {
          return toDocumentResponse(committedDocument);
        }
      } catch (verificationError) {
        removeFinalFile = false;
        console.error('[Vault] Could not verify upload transaction outcome; retaining private file safely.', {
          errorName: verificationError.name,
          code: verificationError.code
        });
      }
    }
    try {
      await cleanupUploadFiles([stagingPath, removeFinalFile ? finalPath : null]);
    } catch (error) {
      cleanupError = error;
      console.error('[Vault] Failed to clean up a private upload artifact.', {
        errorName: error.name,
        code: error.code
      });
    }
    if (!removeFinalFile && !cleanupError) {
      console.error('[Vault] Retained a private upload file because metadata may have committed.');
    }

    try {
      await recordOperationFailure(
        user,
        doctor,
        context,
        'VAULT_DOCUMENT_UPLOAD_FAILED',
        'Doctor',
        doctor._id,
        'UPLOAD_FAILED'
      );
    } catch (auditError) {
      throw auditError;
    }

    if (cleanupError) {
      const error = createError(500, 'Upload failed and private file cleanup could not be completed.');
      throw error;
    }
    console.error('[Vault] Upload failed.', {
      errorName: cause.name,
      code: cause.code,
      statusCode: cause.statusCode
    });
    if (cause.statusCode) throw cause;
    throw createError(500, 'Document upload could not be completed.');
  }
};

const recordUploadFailure = async (user, knownDoctor, context = {}, accessType) => {
  const doctor = await getAuthorizedDoctor(user, context, knownDoctor);
  await recordOperationFailure(
    user,
    doctor,
    context,
    'VAULT_DOCUMENT_UPLOAD_FAILED',
    'Doctor',
    doctor._id,
    accessType || 'MULTIPART_REQUEST_REJECTED'
  );
};

const findOwnedActiveDocument = async (documentId, doctor, user, context, session, includeStorageKey) => {
  if (!isObjectId(documentId)) {
    throw createError(400, 'A valid document ID is required.');
  }
  let query = DocumentVault.findById(documentId);
  if (query && typeof query.select === 'function') {
    query = query.select(includeStorageKey ? '+storageKey' : '-storageKey');
  }
  const document = await withSession(query, session);
  if (
    !document ||
    String(document.ownerDoctorId) !== String(doctor._id) ||
    document.status !== 'ACTIVE'
  ) {
    const error = createAccessError(404, 'Document not found.', {
      resourceType: 'DocumentVault',
      resourceId: documentId,
      accessType: 'OWNER_ONLY'
    });
    return recordDeniedAccess(user, context, error);
  }
  return document;
};

const recordDownloadFailure = (user, doctor, documentId, context, accessType) =>
  recordOperationFailure(
    user,
    doctor,
    context,
    'VAULT_DOCUMENT_DOWNLOAD_FAILED',
    'DocumentVault',
    documentId,
    accessType
  );

const closeFileHandle = async (fileHandle) => {
  if (!fileHandle) return;
  try {
    await fileHandle.close();
  } catch (error) {
    if (error.code !== 'EBADF') throw error;
  }
};

const openDocumentForDownload = async (
  documentId,
  user,
  context = {},
  knownDoctor
) => {
  const doctor = await getAuthorizedDoctor(user, context, knownDoctor);
  const document = await findOwnedActiveDocument(
    documentId,
    doctor,
    user,
    context,
    null,
    true
  );

  let fileHandle;
  try {
    const storageRoot = await getPrivateStorageRoot(false);
    const filePath = getStorageFilePath(document.storageKey, storageRoot);
    const fileStat = await fs.promises.lstat(filePath);
    const realFilePath = await fs.promises.realpath(filePath);
    if (
      fileStat.isSymbolicLink() ||
      !fileStat.isFile() ||
      path.dirname(realFilePath) !== storageRoot
    ) {
      throw createError(404, 'Document file is unavailable.');
    }
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
    fileHandle = await fs.promises.open(filePath, flags);
    const stat = await fileHandle.stat();
    if (!stat.isFile() || stat.size !== document.fileSize) {
      throw createError(404, 'Document file is unavailable.');
    }
  } catch (cause) {
    try {
      await closeFileHandle(fileHandle);
    } catch (closeError) {
      console.error('[Vault] Failed to close an unavailable document handle.', {
        errorName: closeError.name,
        code: closeError.code
      });
    }
    await recordDownloadFailure(
      user,
      doctor,
      document._id,
      context,
      'FILE_UNAVAILABLE'
    );
    if (cause.code === 'ENOENT' || cause.statusCode === 404) {
      throw createError(404, 'Document file is unavailable.');
    }
    if (cause.statusCode) throw cause;
    console.error('[Vault] Document file could not be opened.', {
      errorName: cause.name,
      code: cause.code
    });
    throw createError(500, 'Document file could not be opened.');
  }

  try {
    await recordVaultAudit({
      actorId: user._id,
      action: 'VAULT_DOCUMENT_DOWNLOADED',
      resourceType: 'DocumentVault',
      resourceId: document._id,
      accessType: 'OWNER_ONLY',
      ipAddress: getRequestIp(context)
    });
  } catch (error) {
    await closeFileHandle(fileHandle);
    throw error;
  }
  return {
    document: toDocumentResponse(document),
    fileHandle
  };
};

const deleteDocument = async (documentId, user, context = {}, knownDoctor) => {
  const doctor = await getAuthorizedDoctor(user, context, knownDoctor);
  try {
    return await withRequiredTransaction(async (session) => {
      const document = await findOwnedActiveDocument(
        documentId,
        doctor,
        user,
        context,
        session,
        false
      );
      document.status = 'DELETED';
      await document.save({ session });
      await recordVaultAudit({
        actorId: user._id,
        action: 'VAULT_DOCUMENT_DELETED',
        resourceType: 'DocumentVault',
        resourceId: document._id,
        accessType: 'OWNER_ONLY',
        ipAddress: getRequestIp(context)
      }, session);
      return toDocumentResponse(document);
    });
  } catch (cause) {
    if (cause.auditDenied) {
      throw cause;
    }
    await recordOperationFailure(
      user,
      doctor,
      context,
      'VAULT_DOCUMENT_DELETE_FAILED',
      'DocumentVault',
      isObjectId(documentId) ? documentId : doctor._id,
      'DELETE_FAILED'
    );
    if (cause.statusCode) throw cause;
    console.error('[Vault] Document deletion failed.', {
      errorName: cause.name,
      code: cause.code
    });
    throw createError(500, 'Document deletion could not be completed.');
  }
};

module.exports = {
  authorizeDoctor,
  deleteDocument,
  listDocuments,
  openDocumentForDownload,
  recordUploadFailure,
  uploadDocument
};
