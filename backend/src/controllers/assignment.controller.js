'use strict';

const assignmentService = require('../services/assignment.service');

const createAssignment = async (req, res, next) => {
  try {
    const assignment = await assignmentService.createAssignment(req.body, req.user);
    res.status(201).json({
      success: true,
      message: 'Patient assigned to doctor successfully.',
      data: { assignment }
    });
  } catch (error) {
    next(error);
  }
};

const getPatientAssignment = async (req, res, next) => {
  try {
    const data = await assignmentService.getPatientAssignment(
      req.params.patientId,
      req.user
    );
    res.status(200).json({
      success: true,
      message: 'Patient assignment retrieved successfully.',
      data
    });
  } catch (error) {
    next(error);
  }
};

const getDoctorPatients = async (req, res, next) => {
  try {
    const data = await assignmentService.getDoctorPatients(
      req.params.doctorId,
      req.user
    );
    res.status(200).json({
      success: true,
      message: 'Assigned patients retrieved successfully.',
      data
    });
  } catch (error) {
    next(error);
  }
};

const reassign = async (req, res, next) => {
  try {
    const assignment = await assignmentService.reassign(
      req.params.id,
      req.body,
      req.user
    );
    res.status(200).json({
      success: true,
      message: 'Patient reassigned successfully.',
      data: { assignment }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createAssignment,
  getPatientAssignment,
  getDoctorPatients,
  reassign
};
