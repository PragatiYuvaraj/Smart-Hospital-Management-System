'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { requireVaultAccess } = require('../middleware/vault-access.middleware');
const { parseVaultUpload } = require('../middleware/vault-upload.middleware');
const vaultController = require('../controllers/vault.controller');

const router = express.Router();

router.use(authenticate);
router.use(requireVaultAccess);
router.get('/documents', vaultController.listDocuments);
router.post('/documents', parseVaultUpload, vaultController.uploadDocument);
router.get('/documents/:id/download', vaultController.downloadDocument);
router.delete('/documents/:id', vaultController.deleteDocument);

module.exports = router;
