'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const conversationController = require('../controllers/conversation.controller');

const router = express.Router();

router.use(authenticate);
router.post('/', conversationController.createOrGet);
router.get('/', conversationController.list);
router.get('/:id/messages', conversationController.getMessages);
router.post('/:id/messages', conversationController.sendMessage);
router.patch('/:id/messages/:messageId/read', conversationController.markMessageRead);

module.exports = router;
