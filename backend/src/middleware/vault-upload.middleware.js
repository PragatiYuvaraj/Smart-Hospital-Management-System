'use strict';

const multer = require('multer');
const vaultService = require('../services/vault.service');

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
    fields: 0,
    parts: 1,
    fieldNameSize: 100
  }
});

const parseVaultUpload = (req, res, next) => {
  upload.single('file')(req, res, async (error) => {
    if (!error) {
      next();
      return;
    }
    try {
      await vaultService.recordUploadFailure(
        req.user,
        req.vaultDoctor,
        { ipAddress: req.ip },
        error instanceof multer.MulterError
          ? error.code
          : 'MULTIPART_REQUEST_FAILED'
      );
    } catch (auditError) {
      next(auditError);
      return;
    }

    if (!(error instanceof multer.MulterError)) {
      next(error);
      return;
    }

    const statusCode = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Document exceeds the 5 MB upload limit.'
      : 'Multipart upload must contain exactly one file in the "file" field.';
    const requestError = new Error(message);
    requestError.statusCode = statusCode;
    requestError.errors = [];
    next(requestError);
  });
};

module.exports = { parseVaultUpload };
