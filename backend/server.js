const app = require('./src/app');
const env = require('./src/config/env');
const { connectDB } = require('./src/config/db');
const { startReviewReminderJob } = require('./src/jobs/reviewReminder.job');

/**
 * Initializes and starts the Express HTTP server
 */
const startServer = async () => {
  // Attempt MongoDB connection
  await connectDB();
  startReviewReminderJob();

  // Listen on configured port
  const server = app.listen(env.PORT, () => {
    console.log(`=======================================================`);
    console.log(`  Smart Hospital Management System API`);
    console.log(`  Server running on port: ${env.PORT}`);
    console.log(`  Environment: ${env.NODE_ENV}`);
    console.log(`  Health Check URL: http://localhost:${env.PORT}/api/health`);
    console.log(`  CORS Allowed Origin: ${env.CLIENT_URL}`);
    console.log(`=======================================================`);
  });

  // Handle unhandled promise rejections safely
  process.on('unhandledRejection', (err) => {
    console.error(`[Unhandled Rejection] Error: ${err.message}`);
  });

  return server;
};

if (require.main === module && env.NODE_ENV !== 'test') {
  startServer();
}

module.exports = app;
module.exports.startServer = startServer;
