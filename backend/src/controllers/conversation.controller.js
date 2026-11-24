'use strict';

const messagingService = require('../services/messaging.service');

const requestContext = (req) => ({ ipAddress: req.ip });

const createOrGet = async (req, res, next) => {
  try {
    const result = await messagingService.createOrGetConversation(
      req.body,
      req.user,
      requestContext(req)
    );
    res.status(result.created ? 201 : 200).json({
      success: true,
      message: result.created
        ? 'Conversation created successfully.'
        : 'Conversation retrieved successfully.',
      data: { conversation: result.conversation }
    });
  } catch (error) {
    next(error);
  }
};

const list = async (req, res, next) => {
  try {
    const data = await messagingService.listConversations(
      req.query,
      req.user,
      requestContext(req)
    );
    res.status(200).json({
      success: true,
      message: 'Conversations retrieved successfully.',
      data
    });
  } catch (error) {
    next(error);
  }
};

const getMessages = async (req, res, next) => {
  try {
    const data = await messagingService.getMessages(
      req.params.id,
      req.query,
      req.user,
      requestContext(req)
    );
    res.status(200).json({
      success: true,
      message: 'Conversation messages retrieved successfully.',
      data
    });
  } catch (error) {
    next(error);
  }
};

const sendMessage = async (req, res, next) => {
  try {
    const data = await messagingService.sendMessage(
      req.params.id,
      req.body,
      req.user,
      requestContext(req)
    );
    res.status(201).json({
      success: true,
      message: 'Message sent successfully.',
      data
    });
  } catch (error) {
    next(error);
  }
};

const markMessageRead = async (req, res, next) => {
  try {
    const data = await messagingService.markMessageRead(
      req.params.id,
      req.params.messageId,
      req.user,
      requestContext(req)
    );
    res.status(200).json({
      success: true,
      message: 'Message marked as read.',
      data
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createOrGet,
  getMessages,
  list,
  markMessageRead,
  sendMessage
};
