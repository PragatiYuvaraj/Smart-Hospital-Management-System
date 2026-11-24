const mongoose = require('mongoose');
const dns = require('node:dns');
const env = require('./env');

/**
 * Connects to MongoDB database using Mongoose
 * Handles connection failures gracefully without crashing the server.
 */
const connectDB = async () => {
  try {
    // When connecting to an SRV URI on platforms where Node c-ares defaults to loopback 127.0.0.1,
    // fallback to reliable public DNS resolvers so SRV records resolve.
    if (typeof env.MONGODB_URI === 'string' && env.MONGODB_URI.startsWith('mongodb+srv://')) {
      try {
        const currentServers = dns.getServers();
        if (!currentServers || currentServers.length === 0 || (currentServers.length === 1 && currentServers[0] === '127.0.0.1')) {
          dns.setServers(['8.8.8.8', '1.1.1.1']);
        }
      } catch (dnsErr) {
        // Continue if DNS configuration is restricted
      }
    }

    const conn = await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000
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
