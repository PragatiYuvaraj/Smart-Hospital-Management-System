'use strict';

const reviewService = require('../services/review.service');

const create = async (req, res, next) => {
  try {
    const review = await reviewService.createReview(req.body, req.user);
    res.status(201).json({
      success: true,
      message: 'Patient review scheduled successfully.',
      data: { review }
    });
  } catch (error) {
    next(error);
  }
};

const getUpcoming = async (req, res, next) => {
  try {
    const data = await reviewService.getUpcomingReviews(req.query, req.user);
    res.status(200).json({
      success: true,
      message: 'Review schedules retrieved successfully.',
      data
    });
  } catch (error) {
    next(error);
  }
};

const reschedule = async (req, res, next) => {
  try {
    const review = await reviewService.rescheduleReview(
      req.params.id,
      req.body,
      req.user
    );
    res.status(200).json({
      success: true,
      message: 'Patient review rescheduled successfully.',
      data: { review }
    });
  } catch (error) {
    next(error);
  }
};

const cancel = async (req, res, next) => {
  try {
    const review = await reviewService.cancelReview(req.params.id, req.user);
    res.status(200).json({
      success: true,
      message: 'Patient review cancelled successfully.',
      data: { review }
    });
  } catch (error) {
    next(error);
  }
};

const complete = async (req, res, next) => {
  try {
    const review = await reviewService.completeReview(req.params.id, req.user);
    res.status(200).json({
      success: true,
      message: 'Patient review completed successfully.',
      data: { review }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  cancel,
  complete,
  create,
  getUpcoming,
  reschedule
};
