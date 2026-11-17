'use strict';

const AuditLog = require('../models/AuditLog');

const recordAudit = async (
  { actorId, action, resourceType, resourceId, accessType },
  session
) => {
  const audit = new AuditLog({
    actorId,
    action,
    resourceType,
    resourceId,
    outcome: 'SUCCESS',
    ...(accessType ? { accessContext: { accessType } } : {})
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
