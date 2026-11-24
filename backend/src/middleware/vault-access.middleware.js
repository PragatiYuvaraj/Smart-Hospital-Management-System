'use strict';

const vaultService = require('../services/vault.service');

const requireVaultAccess = async (req, res, next) => {
  try {
    req.vaultDoctor = await vaultService.authorizeDoctor(req.user, {
      ipAddress: req.ip
    });
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = { requireVaultAccess };
