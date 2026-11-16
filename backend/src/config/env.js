const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from backend/.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('[FATAL CONFIG ERROR] JWT_SECRET is not defined in environment variables!');
  console.error('[FATAL CONFIG ERROR] Please define JWT_SECRET in backend/.env before running the server.');
  process.exit(1);
}

const env = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/smart_hospital',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:4200',
  JWT_SECRET: JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '1d',
  HOSPITAL_TIMEZONE: process.env.HOSPITAL_TIMEZONE || 'Asia/Kolkata',
  VAULT_STORAGE_PATH: process.env.VAULT_STORAGE_PATH || 'uploads/vault'
};

module.exports = env;
