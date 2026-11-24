'use strict';

const AuditLog = require('../models/AuditLog');

const recordAudit = async (
  {
    actorId,
    actorType = 'USER',
    action,
    resourceType,
    resourceId,
    accessType,
    outcome = 'SUCCESS',
    ipAddress
  },
  session
) => {
  const audit = new AuditLog({
    actorType,
    ...(actorId ? { actorId } : {}),
    action,
    resourceType,
    resourceId,
    outcome,
    ...(accessType ? { accessContext: { accessType } } : {}),
    ...(ipAddress ? { ipAddress } : {})
  });

  try {
    await audit.save(session ? { session } : undefined);
  } catch (cause) {
    console.error('[Audit] Failed to persist event.', {
      action,
      resourceType,
      errorName: cause.name,
      code: cause.code
    });
    const error = new Error('Audit logging failed; the requested operation may have completed.');
    error.statusCode = 500;
    error.cause = cause;
    throw error;
  }
};

module.exports = { recordAudit };
