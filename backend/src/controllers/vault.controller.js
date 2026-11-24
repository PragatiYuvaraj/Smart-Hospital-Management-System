'use strict';

const vaultService = require('../services/vault.service');

const requestContext = (req) => ({ ipAddress: req.ip });

const listDocuments = async (req, res, next) => {
  try {
    const data = await vaultService.listDocuments(
      req.query,
      req.user,
      requestContext(req),
      req.vaultDoctor
    );
    res.status(200).json({
      success: true,
      message: 'Documents retrieved successfully.',
      data: {
        documents: data.documents,
        pagination: {
          page: data.page,
          limit: data.limit,
          total: data.total,
          totalPages: data.totalPages
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

const uploadDocument = async (req, res, next) => {
  try {
    const document = await vaultService.uploadDocument(
      req.file,
      req.user,
      requestContext(req),
      req.vaultDoctor
    );
    res.status(201).json({
      success: true,
      message: 'Document uploaded successfully.',
      data: { document }
    });
  } catch (error) {
    next(error);
  }
};

const downloadDocument = async (req, res, next) => {
  try {
    const { document, fileHandle } = await vaultService.openDocumentForDownload(
      req.params.id,
      req.user,
      requestContext(req),
      req.vaultDoctor
    );
    const fallbackFilename = document.originalFilename
      .replace(/[^\x20-\x7e]|["\\]/g, '_')
      .replace(/[\r\n]/g, '_');
    const encodedFilename = encodeURIComponent(document.originalFilename)
      .replace(/['()*]/g, (character) =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

    res.set({
      'Content-Type': document.mimeType,
      'Content-Length': String(document.fileSize),
      'Content-Disposition': `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    });
    const stream = fileHandle.createReadStream({ autoClose: true });
    stream.on('error', (error) => {
      console.error('[Vault] Document stream failed.', {
        errorName: error.name,
        code: error.code
      });
      if (res.headersSent) {
        res.destroy();
      } else {
        next(new Error('Document download could not be completed.'));
      }
    });
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
};

const deleteDocument = async (req, res, next) => {
  try {
    const document = await vaultService.deleteDocument(
      req.params.id,
      req.user,
      requestContext(req),
      req.vaultDoctor
    );
    res.status(200).json({
      success: true,
      message: 'Document deleted successfully.',
      data: { document }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  deleteDocument,
  downloadDocument,
  listDocuments,
  uploadDocument
};
