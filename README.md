# Smart Hospital Management System

A full-stack healthcare web application built on the **MEAN stack** (MongoDB, Express.js, Angular, Node.js) for managing continuous patient care, clinical consultations, electronic prescriptions, pharmacy inventory, follow-up scheduling, and secure medical document storage.

---

## 1. Project Overview & Architecture

The **Smart Hospital Management System** connects hospital staff and patients across three primary operational roles:
* **Doctor / Chief Medical Officer (CMO):** Review assigned patients, record and finalize clinical consultations, issue prescriptions, manage secure vault documents, and oversee staff privileges (CMO).
* **Pharmacy:** Monitor active prescription queues, dispense medications against batch inventory, manage stock levels, and track inventory transactions.
* **Patient:** Access personal medical records, review consultation summaries and active prescriptions, track follow-up appointments, and communicate securely with assigned physicians.

The system is structured as a decoupled 3-tier client-server architecture:
* **Frontend:** Standalone Angular 18 Single Page Application (SPA) with a modern clinical healthcare SaaS design system.
* **Backend:** Node.js & Express RESTful API with modular controllers, services, and authorization middleware.
* **Database:** MongoDB document store modeled via Mongoose schemas with indexing and referential integrity.

For in-depth architectural and schema details, refer to:
* [System Architecture Document](docs/architecture.md)
* [Database Design & Schema Document](docs/database_design.md)
* [Postman API Scenarios & Verification](docs/postman_m3_scenarios.md)
* [Business Requirements Document (PDF)](docs/Smart_Hospital_Management_System_BRD.pdf)

---

## 2. Prerequisites

Ensure the following prerequisites are installed on your host system:
* **Node.js:** Node.js LTS (`v18.x` or `v20.x` LTS recommended).
* **npm:** Node Package Manager (bundled with Node.js, `v9.x` or `v10.x`).
* **MongoDB:** MongoDB Community Server (`v6.0+` or `v7.0+`) running locally on default port `27017`, or a cloud MongoDB Atlas connection URI.
* **Git:** Version control system for source management.

---

## 3. Installation

The application repository separates frontend and backend codebases into distinct subdirectories. Dependencies must be installed in both directories.

### Backend Dependencies
Open a terminal in the project root and navigate to the backend directory:
```bash
cd backend
npm install
```

### Frontend Dependencies
Open a terminal in the project root and navigate to the frontend directory:
```bash
cd frontend
npm install
```

---

## 4. Environment Configuration

The backend reads configuration settings from `backend/.env`. A reference template is provided at `backend/.env.example`.

### Step-by-Step Setup
1. Copy the example configuration to create your local `.env`:
   ```bash
   # On Windows (PowerShell):
   Copy-Item backend/.env.example backend/.env

   # On Linux / macOS (Bash):
   cp backend/.env.example backend/.env
   ```

2. Open `backend/.env` in your editor and configure the necessary variables:
   * `PORT`: Port for the Express server (default: `5000`).
   * `NODE_ENV`: Runtime mode (`development` or `production`).
   * `MONGODB_URI`: MongoDB connection string (default: `mongodb://127.0.0.1:27017/smart_hospital`).
   * `CLIENT_URL`: URL of the frontend application (default: `http://localhost:4200`).
   * `JWT_SECRET`: A strong, random secret string used to sign and verify JSON Web Tokens (required; server will not start without it).
   * `JWT_EXPIRES_IN`: Token validity duration (default: `1d`).
   * `HOSPITAL_TIMEZONE`: Timezone for clinical review scheduling (default: `Asia/Kolkata`).
   * `VAULT_STORAGE_PATH`: Storage directory for encrypted/private document uploads (default: `uploads/vault`).

> **Security Note:** Never commit `backend/.env` or any real connection strings, credentials, or private keys to version control. The `.env` file is excluded via `.gitignore`.

---

## 5. Database Seeding & Bootstrap Guidance

> ⚠️ **IMPORTANT NOTICE:** Seed and bootstrap scripts mutate database records and **must only be executed when explicitly required** (such as initializing a fresh development environment). Never run seed or bootstrap scripts against an active production database.

### Initial CMO Account Provisioning (Bootstrap)
To provision the initial Chief Medical Officer account holding `MANAGE_USERS` privileges:
1. Configure `BOOTSTRAP_CMO_EMAIL`, `BOOTSTRAP_CMO_NAME`, and `BOOTSTRAP_CMO_PASSWORD` in `backend/.env`.
2. From the `backend` directory, run:
   ```bash
   cd backend
   npm run bootstrap
   ```
3. Remove or comment out the `BOOTSTRAP_CMO_*` entries from `backend/.env` once the account has been created.

### Synthetic Demo Data Seeding (Optional)
To populate a fresh local development database with synthetic demonstration doctors, patients, medicines, and consultation history:
1. Set `DEMO_DOCTOR_PASSWORD`, `DEMO_PHARMACY_PASSWORD`, and `DEMO_PATIENT_PASSWORD` privately in `backend/.env`. The seed script reads these values but does not print them; it does not reset passwords for accounts that already exist.
2. From the `backend` directory, run:
```bash
cd backend
npm run seed
```
To seed only the medicine catalogue and batch inventory:
```bash
cd backend
npm run seed:medicines
```

---

## 6. Running the Application

Run the backend API server and frontend Angular application in two separate terminal windows.

### Terminal 1: Backend API Server
```bash
cd backend
npm run dev
```
* The backend server will start at: `http://localhost:5000`
* For production execution without file watching: `npm start`

### Terminal 2: Frontend Angular Client
```bash
cd frontend
npm start
```
* The Angular development server will compile and serve the application at: `http://localhost:4200`
* For a production build: `npm run build`

---

## 7. Service Endpoints & Health Check

* **Frontend Application:** [http://localhost:4200](http://localhost:4200)
* **Backend API Root:** [http://localhost:5000/](http://localhost:5000/)
* **Backend Health Check:** [http://localhost:5000/api/health](http://localhost:5000/api/health)

Verify that the backend is running properly by querying the health-check endpoint:
```bash
curl http://localhost:5000/api/health
```
A healthy backend responds with:
```json
{
  "status": "UP",
  "timestamp": "2026-11-23T...",
  "services": {
    "database": "CONNECTED"
  }
}
```

---

## 8. Role Guidance & Authentication

The platform provides granular Role-Based Access Control (RBAC):

1. **Doctor / CMO:**
   * Access to Assigned Patients, Consultations, Electronic Prescriptions, and Document Vault.
   * Doctors with `MANAGE_USERS` (CMO) have access to the **Staff Management** module to provision new Doctor and Pharmacy accounts.
   * Doctors with `DUTY_DOCTOR` can provide coverage for cross-assigned patients.
2. **Pharmacy Staff:**
   * Access to the Prescription Queue, Dispensing Workflow, Medicine Catalogue, and Batch Stock Adjustments.
3. **Patient:**
   * Self-registration available via the registration page.
   * Access to personal health records, prescription list, review schedule, and doctor messaging.

> **Demonstration Accounts:** In development mode, the login page provides convenient demo role selector presets for testing each persona. For custom staff accounts, log in as the bootstrapped CMO to invite staff members or register a patient through the frontend registration portal.

---

## 9. Available NPM Scripts Reference

### Backend (`backend/package.json`)
| Command | Action |
|---|---|
| `npm run dev` | Start Express server with `nodemon` live-reload |
| `npm start` | Start Express server with Node.js in standard mode |
| `npm run bootstrap` | Provision the initial CMO account (reads `BOOTSTRAP_CMO_*` from `.env`) |
| `npm run seed` | Seed synthetic clinical demo data (run only when explicitly needed) |
| `npm run seed:medicines` | Populate initial medicine inventory and batches |
| `npm test` | Execute full automated test suite (`tests/run-all.js`) |
| `npm run test:rbac` | Run RBAC and authorization tests |
| `npm run test:vault` | Run document vault upload and access tests |

### Frontend (`frontend/package.json`)
| Command | Action |
|---|---|
| `npm start` | Run `ng serve` on `http://localhost:4200` |
| `npm run build` | Compile Angular application to `frontend/dist/` |
| `npm run watch` | Build Angular application with incremental watch mode |
