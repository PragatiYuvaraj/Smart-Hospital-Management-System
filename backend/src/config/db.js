const mongoose = require('mongoose');
const env = require('./env');

/**
 * Connects to MongoDB database using Mongoose
 * Handles connection failures gracefully without crashing the server.
 */
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 4000
    });
    console.log(`[MongoDB] Connected successfully to host: ${conn.connection.host}`);
    return true;
  } catch (error) {
    console.warn('[MongoDB] Connection warning: Could not connect to the configured MongoDB deployment.');
    console.warn(
      `[MongoDB] Detail: ${error.name}${error.code ? ` (${error.code})` : ''}`
    );
    console.warn('[MongoDB] Note: Express server will continue running. Please start local MongoDB or provide MONGODB_URI in .env.');
    return false;
  }
};

/**
 * Returns human-readable MongoDB connection status
 */
const getDBStatus = () => {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };
  return states[mongoose.connection.readyState] || 'unknown';
};

module.exports = { connectDB, getDBStatus };
