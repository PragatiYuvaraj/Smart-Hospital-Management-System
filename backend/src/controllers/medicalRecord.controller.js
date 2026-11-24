'use strict';

const medicalRecordService = require('../services/medicalRecord.service');

const create = async (req, res, next) => {
  try {
    const consultation = await medicalRecordService.createConsultation(req.user, req.body);
    res.status(201).json({
      success: true,
      message: 'Consultation recorded successfully.',
      data: consultation
    });
  } catch (error) {
    next(error);
  }
};

const getPatientHistory = async (req, res, next) => {
  try {
    const patientId = req.params.id || req.params.patientId;
    const history = await medicalRecordService.getPatientHistory(patientId, req.user, req.query);
    res.status(200).json({
      success: true,
      message: 'Patient medical records retrieved successfully.',
      data: history
    });
  } catch (error) {
    next(error);
  }
};

const getDetail = async (req, res, next) => {
  try {
    const consultation = await medicalRecordService.getConsultationDetail(req.params.id, req.user);
    res.status(200).json({
      success: true,
      message: 'Consultation detail retrieved successfully.',
      data: consultation
    });
  } catch (error) {
    next(error);
  }
};

const updateDraft = async (req, res, next) => {
  try {
    const updated = await medicalRecordService.updateDraftConsultation(req.params.id, req.user, req.body);
    res.status(200).json({
      success: true,
      message: 'Draft consultation updated successfully.',
      data: updated
    });
  } catch (error) {
    next(error);
  }
};

const finalize = async (req, res, next) => {
  try {
    const finalized = await medicalRecordService.finalizeConsultation(req.params.id, req.user, req.body);
    res.status(200).json({
      success: true,
      message: 'Consultation finalized successfully.',
      data: finalized
    });
  } catch (error) {
    next(error);
  }
};

const setRelease = async (req, res, next) => {
  try {
    const isReleased = req.body && typeof req.body.isReleased === 'boolean' ? req.body.isReleased : true;
    const updated = await medicalRecordService.setPatientRelease(req.params.id, req.user, isReleased);
    res.status(200).json({
      success: true,
      message: isReleased ? 'Consultation released to patient.' : 'Consultation release retracted.',
      data: updated
    });
  } catch (error) {
    next(error);
  }
};

const addAmendment = async (req, res, next) => {
  try {
    const amended = await medicalRecordService.addAmendment(req.params.id, req.user, req.body);
    res.status(200).json({
      success: true,
      message: 'Consultation amended successfully.',
      data: amended
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  create,
  getPatientHistory,
  getDetail,
  updateDraft,
  finalize,
  setRelease,
  addAmendment
};
