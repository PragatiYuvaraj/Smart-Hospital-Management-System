const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const env = require('./config/env');
const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');

const app = express();

// Security HTTP headers
app.use(helmet());

// CORS configuration to allow local Angular development server
app.use(cors({
  origin: [env.CLIENT_URL, 'http://localhost:4200', 'http://127.0.0.1:4200'],
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
  console.error('[Unhandled Server Error]', err);
  res.status(err.statusCode || err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    errors: err.errors || []
  });
});

module.exports = app;
