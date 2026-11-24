const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const env = require('./config/env');
const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const patientRoutes = require('./routes/patient.routes');
const doctorRoutes = require('./routes/doctor.routes');
const assignmentRoutes = require('./routes/assignment.routes');
const medicalRecordRoutes = require('./routes/medicalRecord.routes');
const prescriptionRoutes = require('./routes/prescription.routes');
const medicineRoutes = require('./routes/medicine.routes');
const stockRoutes = require('./routes/stock.routes');
const dispensingRoutes = require('./routes/dispensing.routes');
const reviewRoutes = require('./routes/review.routes');
const notificationRoutes = require('./routes/notification.routes');
const conversationRoutes = require('./routes/conversation.routes');
const vaultRoutes = require('./routes/vault.routes');

const app = express();

// Security HTTP headers
app.use(helmet());

// CORS configuration: in production, allow only explicitly configured origins.
// In development/test, also allow local Angular development server.
const allowedCorsOrigins = env.NODE_ENV === 'production'
  ? env.CORS_ORIGINS
  : Array.from(new Set([
      ...(env.CORS_ORIGINS || []),
      env.CLIENT_URL,
      'http://localhost:4200',
      'http://127.0.0.1:4200'
    ]));

app.use(cors({
  origin: allowedCorsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Primary health check endpoint
app.use('/api/health', healthRoutes);

// Authentication endpoints
app.use('/api/auth', authRoutes);

// User management endpoints (Milestone 3)
app.use('/api/users', userRoutes);

// Patient self-service profile endpoints
app.use('/api/patients', patientRoutes);

// Doctor profile management endpoints
app.use('/api/doctors', doctorRoutes);

// Doctor–patient assignment management
app.use('/api/assignments', assignmentRoutes);

// Consultation and medical records endpoints
app.use('/api/medical-records', medicalRecordRoutes);

// Pharmacy prescription and inventory endpoints
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/medicines', medicineRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/dispensing', dispensingRoutes);

// Follow-up review schedules and in-app reminders
app.use('/api/reviews', reviewRoutes);
app.use('/api/notifications', notificationRoutes);

// Patient–doctor messaging; services enforce and audit the role/relationship boundary.
app.use('/api/conversations', conversationRoutes);

// Private doctor-owned document storage.
app.use('/api/vault', vaultRoutes);

// Root landing endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Smart Hospital Management System API',
    version: '1.0.0',
    documentation: '/docs',
    healthCheck: '/api/health'
  });
});

// 404 Route Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint ${req.originalUrl} not found.`,
    errors: []
  });
});

// Centralized Error Handler
app.use((err, req, res, next) => {
  // Retain detailed server-side error logging
  console.error('[Unhandled Server Error]', err);

  const status = err.statusCode || err.status || 500;
  const isProduction = env.NODE_ENV === 'production';

  // Prevent raw internal error messages from leaking to clients in production
  const message = isProduction && status >= 500
    ? 'Internal Server Error'
    : (err.message || 'Internal Server Error');

  const errors = isProduction && status >= 500
    ? []
    : (err.errors || []);

  res.status(status).json({
    success: false,
    message,
    errors
  });
});

module.exports = app;
