'use strict';

const notificationService = require('../services/notification.service');

const getMine = async (req, res, next) => {
  try {
    const data = await notificationService.getMyNotifications(req.query, req.user);
    res.status(200).json({
      success: true,
      message: 'Notifications retrieved successfully.',
      data
    });
  } catch (error) {
    next(error);
  }
};

const markAsRead = async (req, res, next) => {
  try {
    const notification = await notificationService.markAsRead(
      req.params.id,
      req.user
    );
    res.status(200).json({
      success: true,
      message: 'Notification marked as read.',
      data: { notification }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMine,
  markAsRead
};
