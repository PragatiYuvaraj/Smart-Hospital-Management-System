# PROJECT CONTEXT
# Smart Hospital Management System

## 1. Project Overview

**Project Name:** Smart Hospital Management System

**Project Type:** Internship Major Project

**Project Version:** 1.0

**Project Architecture:** Full-Stack Web Application

The Smart Hospital Management System is a web-based application designed to connect doctors, patients, and medical/pharmacy staff through a centralized hospital management platform.

The primary objective is to maintain a continuous and chronological record of patient care rather than treating every consultation as an isolated appointment.

The application will allow doctors to manage assigned patients, access medical histories, document consultations, create prescriptions, and schedule follow-up reviews.

Patients will be able to securely access their personal medical information, prescriptions, upcoming reviews, notifications, and communicate with their assigned doctors.

Medical/pharmacy staff will manage medicine catalogues, batch-level inventory, prescription dispensing, stock availability, and expiry monitoring.

The system will also provide a restricted document vault for storing hospital and doctor professional credentials.

This project is an educational prototype and must use synthetic/demo data only.

---

## 2. Technology Stack

The project must follow the MEAN Stack architecture.

### Frontend
- Angular
- TypeScript
- HTML5
- CSS3
- Angular Router
- Angular Reactive Forms
- Angular HTTP Client
- Angular Route Guards
- HTTP Interceptors

### Backend
- Node.js
- Express.js
- JavaScript
- RESTful API architecture
- JSON request and response format

### Database
- MongoDB
- Mongoose ODM

### Authentication and Security
- JSON Web Tokens (JWT)
- bcrypt password hashing
- Role-Based Access Control (RBAC)
- Resource-Level Authorization
- Express authentication middleware
- Input validation and sanitization
- Audit logging
- Private document storage

### Development and Testing Tools
- Visual Studio Code / Antigravity
- Git
- GitHub
- Postman
- MongoDB Compass
- npm

**Important:** Use Angular, not React, because the mentor-provided BRD specifies Angular as the frontend framework.

---

## 3. Application User Roles

The application has three primary user roles.

### 3.1 DOCTOR

Doctors are responsible for managing patient care.

Permissions and functionalities:

- Secure login.
- View assigned patients.
- Search and access authorized patient profiles.
- View chronological medical history.
- Record patient consultations.
- Add symptoms, observations, diagnoses, clinical notes, and treatment plans.
- Create prescriptions.
- Schedule follow-up reviews.
- View upcoming and overdue reviews.
- Communicate with assigned patients.
- Access authorized hospital/doctor documents through the document vault.
- View doctor dashboard statistics.

### 3.2 PATIENT

Patients can access and manage their permitted personal information.

Permissions and functionalities:

- Self-registration.
- Secure login.
- View and update permitted personal profile information.
- View their assigned treating doctor.
- View released medical history.
- View prescriptions.
- View upcoming follow-up reviews.
- Receive in-app notifications.
- Mark notifications as read.
- Communicate with their assigned doctor or care team.

Patients must never access another patient's information.

### 3.3 PHARMACY / MEDICAL STAFF

Pharmacy staff are responsible for medicine and inventory management.

Permissions and functionalities:

- Secure login.
- View prescriptions awaiting dispensing.
- Search the medicine catalogue.
- Add and manage medicine catalogue entries.
- Manage medicine batches.
- Record received stock.
- Monitor available stock.
- Identify low-stock medicines.
- Identify expired and near-expiry batches.
- Dispense prescribed medicines.
- View dispensing and stock transaction history.

Pharmacy staff must not access complete clinical histories, private clinical notes, or the document vault.

### 3.4 DUTY DOCTOR PERMISSION

Duty Doctor is not a separate primary application role.

It is an additional permission assigned to an authorized doctor.

A treating doctor can access assigned patients by default. A doctor with the DUTY_DOCTOR permission can access hospital-wide patient records within the authorized duty context.

All cross-coverage access must be recorded in audit logs.

---

## 4. Core Application Modules

The application should be developed as independent, modular features.

### Module 1: Authentication and User Management

Features:
- Patient registration.
- User login.
- JWT token generation and validation.
- Password hashing.
- Role-based authorization.
- Authenticated user profile retrieval.
- Account activation/deactivation.
- Profile management.

Rules:
- Patients can self-register.
- Doctor and pharmacy accounts must be created or approved through an authorized hospital process.
- Each account must have one primary role: DOCTOR, PATIENT, or PHARMACY.
- Doctor accounts may additionally have the DUTY_DOCTOR permission.
- Never trust role or identity information sent directly by the frontend.

### Module 2: Patient Management

Features:
- Create and manage patient profiles.
- Generate unique patient identifiers.
- Search and filter patients.
- View patient details.
- Update permitted personal information.
- Maintain patient assignment information.

Patient profile fields:
- Patient ID.
- User ID.
- Patient number.
- Full name.
- Date of birth.
- Contact information.
- Address.
- Status.

### Module 3: Doctor Management and Patient Assignment

Features:
- Doctor profile management.
- Assign patients to doctors.
- Reassign patients.
- View currently assigned patients.
- Maintain assignment history.

Assignment information:
- Patient ID.
- Doctor ID.
- Assignment type.
- Start date.
- End date.
- Status.
- Assigned by.

Previous assignments must be preserved and must not be deleted when a patient is reassigned.

### Module 4: Medical History and Consultation Management

Features:
- View chronological medical history.
- Create new consultations.
- Record symptoms and observations.
- Record diagnosis.
- Add clinical notes.
- Create treatment plans.
- View previous consultations.
- Maintain amendments to finalized records.

Each consultation should contain:
- Patient ID.
- Doctor ID.
- Encounter date and time.
- Reason for visit.
- Symptoms.
- Clinical observations.
- Diagnosis.
- Notes.
- Treatment plan.
- Status.

Every consultation must create a separate medical record.

Finalized medical records must not be silently overwritten. Corrections must be documented through amendments with an author, timestamp, and reason.

### Module 5: Follow-up Review Scheduling and Notifications

Features:
- Schedule patient follow-up reviews.
- Assign a responsible doctor.
- Add review date and time.
- Add review instructions.
- View upcoming reviews.
- View overdue reviews.
- Generate in-app reminders.
- Mark notifications as read.

Important business rule:

The system must schedule an in-app notification exactly two calendar days before the scheduled review, using the configured hospital timezone.

Additional rules:
- Changing a review date must reschedule its pending reminder.
- Cancelling a review must cancel its pending reminder.
- Duplicate reminders must be prevented.
- Reminder processing must be idempotent.
- Notification statuses: SCHEDULED, SENT, READ, FAILED, CANCELLED.

Email and SMS notifications are optional enhancements. In-app notifications are mandatory.

### Module 6: Prescription Management

Features:
- Create prescriptions linked to consultations.
- Select medicines from the medicine catalogue.
- Specify dosage.
- Specify route where applicable.
- Specify frequency.
- Specify duration.
- Specify quantity.
- Add patient instructions.
- View prescription status.
- Display prescriptions in the pharmacy queue.

Prescription information:
- Patient ID.
- Doctor ID.
- Medical record ID.
- Medicine items.
- Prescribed dosage.
- Route.
- Frequency.
- Duration.
- Quantity.
- Instructions.
- Issue date.
- Status.

Important rule:

Creating a prescription must NOT automatically reduce medicine stock. Stock must only be reduced when pharmacy staff actually dispense the medicine.

### Module 7: Pharmacy and Inventory Management

Features:
- Medicine catalogue management.
- Medicine batch management.
- Stock receipt.
- Available stock monitoring.
- Low-stock alerts.
- Expiry monitoring.
- Prescription dispensing.
- Stock transaction history.

Medicine information:
- Medicine name.
- Generic name.
- Strength.
- Form.
- Manufacturer.
- Reorder level.
- Active status.

Medicine batch information:
- Medicine ID.
- Batch number.
- Expiry date.
- Received quantity.
- Available quantity.
- Received date.

Dispensing must:
- Validate prescription status.
- Validate batch expiry.
- Validate available quantity.
- Record the quantity dispensed.
- Reduce the correct batch stock.
- Generate a stock transaction.
- Prevent negative inventory.

Expired batches must never be available for dispensing.

### Module 8: Patient–Doctor Messaging

Features:
- Patient sends messages to assigned doctor/care team.
- Doctor views patient conversations.
- Doctor replies to patient messages.
- Store sender and recipient information.
- Store timestamps.
- Maintain read status.
- Maintain conversation history.

Important rule:

Messaging is intended only for non-emergency communication.

The interface must clearly display an emergency disclaimer stating that messages are not monitored for emergencies and must not be used for urgent medical assistance.

### Module 9: Private Document Vault

Purpose:

Provide a restricted storage facility for hospital and doctor professional documents.

Document categories may include:
- Hospital registration certificates.
- Hospital approvals.
- Doctor professional registration documents.
- Doctor qualification certificates.

Features:
- Upload documents.
- View document metadata.
- List authorized documents.
- Download documents.
- Track document expiry information.
- Record document access in audit logs.

Security rules:
- Only authorized doctor accounts with vault permission can access documents.
- Patients must be denied access.
- Pharmacy users must be denied access.
- Files must not be stored in publicly accessible folders.
- Downloads must require backend authorization.
- Upload, download, and deletion activities must be audited.

Use synthetic sample documents only. Do not upload actual government certificates.

### Module 10: Role-Based Dashboards

Doctor Dashboard:
- Total assigned patients.
- Today's consultations.
- Upcoming reviews.
- Overdue follow-ups.
- Pending messages.
- Quick access to patient history.

Patient Dashboard:
- Assigned treating doctor.
- Medical history summary.
- Active prescriptions.
- Upcoming reviews.
- In-app notifications.

Pharmacy Dashboard:
- Pending prescriptions.
- Medicine stock summary.
- Low-stock medicines.
- Expired batches.
- Near-expiry batches.
- Dispensing history.

Each dashboard must display only information permitted for the authenticated user.

---

## 5. MongoDB Collections and Data Models

Use Mongoose schemas with appropriate validation, timestamps, references, and indexes.

Recommended collections:

### users
- email
- passwordHash
- role
- permissions
- status
- createdAt
- lastLoginAt

### patients
- userId
- patientNumber
- name
- dateOfBirth
- contactDetails
- address
- status

### doctors
- userId
- doctorNumber
- name
- specialization
- registrationReference
- department
- status

### doctorAssignments
- patientId
- doctorId
- assignmentType
- startDate
- endDate
- status
- assignedBy

### medicalRecords
- patientId
- doctorId
- encounterDate
- reason
- symptoms
- observations
- diagnosis
- notes
- treatmentPlan
- status
- amendments

### prescriptions
- patientId
- doctorId
- medicalRecordId
- items[]
- issuedAt
- status

### medicines
- name
- genericName
- strength
- form
- manufacturer
- reorderLevel
- active

### medicineBatches
- medicineId
- batchNumber
- expiryDate
- receivedQuantity
- availableQuantity
- receivedAt

### stockTransactions
- medicineId
- batchId
- prescriptionId
- transactionType
- quantity
- actorId
- timestamp
- reason

### reviewSchedules
- patientId
- doctorId
- reviewDate
- instructions
- status
- reminderStatus

### notifications
- recipientId
- reviewId
- type
- scheduledAt
- sentAt
- readAt
- status
- deduplicationKey

### conversations / messages
- patientId
- doctorId
- senderId
- body
- createdAt
- readAt
- status

### documentVault
- category
- title
- storageKey
- metadata
- uploadedBy
- uploadedAt
- expiryDate
- status

### auditLogs
- actorId
- action
- resourceType
- resourceId
- timestamp
- outcome
- accessContext

Use MongoDB ObjectId references where appropriate.

Recommended indexes:
- Unique index on users.email.
- Unique index on patients.patientNumber.
- Unique index on doctors.doctorNumber.
- doctorAssignments: patientId + status.
- doctorAssignments: doctorId + status.
- medicalRecords: patientId + encounterDate descending.
- reviewSchedules: status + reviewDate.
- notifications: status + scheduledAt.
- medicineBatches: medicineId + expiryDate.
- stockTransactions: batchId + timestamp.
- auditLogs: resourceType + resourceId + timestamp.
- auditLogs: actorId + timestamp.

---

## 6. Backend Architecture

Follow a modular, layered Express.js architecture.

Suggested structure:

backend/
  src/
    config/
      db.js
      env.js
      storage.js

    models/
      User.js
      Patient.js
      Doctor.js
      DoctorAssignment.js
      MedicalRecord.js
      Prescription.js
      Medicine.js
      MedicineBatch.js
      StockTransaction.js
      ReviewSchedule.js
      Notification.js
      Conversation.js
      Message.js
      DocumentVault.js
      AuditLog.js

    routes/
      auth.routes.js
      patient.routes.js
      doctor.routes.js
      assignment.routes.js
      medicalRecord.routes.js
      prescription.routes.js
      medicine.routes.js
      inventory.routes.js
      review.routes.js
      notification.routes.js
      message.routes.js
      vault.routes.js

    controllers/
      auth.controller.js
      patient.controller.js
      doctor.controller.js
      assignment.controller.js
      medicalRecord.controller.js
      prescription.controller.js
      inventory.controller.js
      review.controller.js
      notification.controller.js
      message.controller.js
      vault.controller.js

    services/
      auth.service.js
      patient.service.js
      assignment.service.js
      medicalRecord.service.js
      prescription.service.js
      inventory.service.js
      review.service.js
      notification.service.js
      message.service.js
      vault.service.js

    middleware/
      authenticate.js
      authorizeRole.js
      authorizeResource.js
      errorHandler.js

    validators/
    jobs/
      reviewReminder.job.js

    utils/
      ApiResponse.js
      ApiError.js
      generateToken.js

    app.js
    server.js

  .env
  .env.example
  .gitignore
  package.json

Responsibilities:

- Models: MongoDB schemas and database structure.
- Routes: API endpoint definitions.
- Controllers: HTTP request and response handling.
- Services: Business logic and workflows.
- Middleware: Authentication, authorization, and error handling.
- Validators: Input validation.
- Jobs: Scheduled background tasks.
- Config: Database, environment, and storage configuration.

Keep routes thin and business logic inside services.

---

## 7. Frontend Architecture

Use Angular with feature-based modular organization.

Suggested structure:

frontend/
  src/
    app/
      core/
        auth/
        guards/
        interceptors/
        services/

      shared/
        components/
        models/
        pipes/

      features/
        auth/
        doctor/
        patient/
        pharmacy/
        medical-history/
        prescriptions/
        reviews/
        notifications/
        messaging/
        document-vault/

      app.routes.ts
      app.config.ts

    assets/
    environments/

  angular.json
  package.json

Frontend responsibilities:

- Provide responsive user interfaces.
- Implement role-specific navigation.
- Integrate with Express REST APIs.
- Implement authentication state management.
- Use HTTP interceptors for authorized API requests.
- Use Angular route guards for user navigation.
- Use reactive forms and client-side validation.
- Display loading states and error messages.
- Restrict visible UI features according to user permissions.

Important:

Frontend route guards are not security boundaries. All authorization must also be enforced on the backend.

---

## 8. REST API Requirements

Use the base URL:

/api

### Authentication
- POST /api/auth/register
- POST /api/auth/login
- GET /api/auth/me

### Patients
- GET /api/patients
- GET /api/patients/:id

### Assignments
- POST /api/assignments
- GET /api/doctors/:id/patients

### Medical History
- GET /api/patients/:id/medical-records
- POST /api/medical-records
- POST /api/medical-records/:id/amendments

### Reviews
- POST /api/reviews
- GET /api/reviews/upcoming

### Notifications
- GET /api/notifications/my
- PATCH /api/notifications/:id/read

### Prescriptions
- POST /api/prescriptions
- GET /api/prescriptions/pending

### Inventory
- GET /api/medicines
- GET /api/medicines/availability
- POST /api/dispensing
- POST /api/stock/receipts

### Messaging
- POST /api/conversations/:id/messages
- GET /api/conversations

### Document Vault
- GET /api/vault/documents
- POST /api/vault/documents
- GET /api/vault/documents/:id/download

All APIs must:
- Validate request data.
- Apply authentication and authorization.
- Return consistent JSON responses.
- Handle errors centrally.
- Use suitable HTTP status codes.
- Support pagination for relevant listing endpoints.

Suggested response format:

{
  "success": true,
  "message": "Operation completed successfully",
  "data": {}
}

Error responses should follow the same consistent structure.

HTTP status conventions:
- 200: Successful request.
- 201: Resource created.
- 400: Validation error.
- 401: Authentication required or invalid.
- 403: Access forbidden.
- 404: Resource not found.
- 409: Conflict.

---

## 9. Critical Business Rules

These rules must be followed throughout implementation.

1. Patients can access only their own records.
2. Treating doctors can access only assigned patients by default.
3. Duty Doctor access requires explicit permission and audit logging.
4. Pharmacy users cannot access full clinical notes or the document vault.
5. Previous doctor assignments must be preserved.
6. Finalized consultations must not be overwritten.
7. Corrections to finalized records must be auditable amendments.
8. Review reminders must be scheduled two calendar days before the review.
9. Changing a review date must update the pending reminder.
10. Cancelling a review must cancel the pending reminder.
11. Duplicate notifications must be prevented.
12. Prescriptions must not directly reduce inventory.
13. Inventory must be reduced only after actual pharmacy dispensing.
14. Stock must never become negative.
15. Expired medicine batches cannot be dispensed.
16. Every stock transaction must identify the responsible user.
17. Vault access must be checked on every backend request.
18. Sensitive medical-record and document access must be audited.
19. Messages must display the non-emergency disclaimer.
20. Only synthetic/demo data must be used.

---

## 10. Security Requirements

Implement security at the backend level.

- Hash passwords using bcrypt.
- Use JWT authentication.
- Validate token expiration.
- Protect private APIs using authentication middleware.
- Implement role-based authorization.
- Implement resource-level authorization.
- Validate and sanitize incoming data.
- Use secure HTTP headers.
- Configure CORS allowlists.
- Apply authentication rate limiting.
- Keep secrets in environment variables.
- Never commit .env files.
- Avoid exposing stack traces.
- Keep uploaded documents outside public folders.
- Validate uploaded file types and sizes.
- Use generated storage keys.
- Log sensitive operations without storing passwords, tokens, or unnecessary clinical information.
- Use appropriate storage encryption and HTTPS for deployed environments.

---

## 11. Non-Functional Requirements

### Performance
Use pagination and indexed queries for large lists.

### Reliability
Implement centralized error handling, validation, and safe stock transaction handling.

### Data Integrity
Prevent negative stock, preserve finalized clinical records, and enforce unique identifiers.

### Usability
Build responsive interfaces with clear navigation, loading indicators, and validation messages.

### Maintainability
Use modular Angular features and layered Express architecture.

### Testability
Use Postman collections and basic unit/integration tests.

### Timezone
Store timestamps consistently, preferably in UTC, and schedule/display reminders using the configured hospital timezone.

---

## 12. Development Timeline

The mentor's BRD specifies this 15-day schedule.

Day 1:
Understand requirements, user roles, workflows, and UI wireframes.

Day 2:
Build a mini-project with basic CRUD backend and MongoDB connection.

Day 3:
Build Angular forms, lists, and API integration for the mini-project.

Day 4:
Test and complete the mini-project demonstration.

Day 5:
Review the mini-project, initialize the major project, Git, and architecture.

Day 6:
Develop MongoDB schemas, authentication, JWT, and role middleware.

Day 7:
Develop patient/doctor profiles and doctor-patient assignments.

Day 8:
Develop medical history timeline and consultation records.

Day 9:
Develop review scheduling and in-app notification jobs.

Day 10:
Develop prescriptions and medicine catalogue.

Day 11:
Develop batch inventory, stock transactions, and dispensing.

Day 12:
Develop Angular role dashboards, patient timeline, and messaging.

Day 13:
Develop document vault security and dashboard integration.

Day 14:
Integration, access-control tests, bug fixing, and documentation.

Day 15:
Final demonstration, Postman collection, setup guide, and retrospective.

Prioritize a working end-to-end application over isolated incomplete modules. Any necessary scope changes must be discussed and documented.

---

## 13. Acceptance Criteria

The project is considered functionally complete when:

- Patients can register and log in.
- Doctors can view multiple assigned patients.
- Patients can access only their own data.
- Authorized duty doctors can access hospital-wide records with audit logging.
- Doctors can create and preserve consultation records.
- Doctors can create prescriptions linked to consultations.
- Pharmacy users can view pending prescriptions.
- Pharmacy users can dispense medicines.
- Dispensing updates the correct batch inventory.
- Negative stock and expired-batch dispensing are prevented.
- Doctors can schedule follow-up reviews.
- Patients receive in-app reminders two days before reviews.
- Rescheduling and cancelling reviews update or cancel pending reminders.
- Patients can view their own notifications and prescriptions.
- Pharmacy users cannot access clinical notes or the document vault.
- Authorized doctors can access vault documents.
- Vault access is recorded in audit logs.
- Patient–doctor messaging works within authorization boundaries.
- Angular frontend integrates with Express APIs.
- Core workflows are tested using Postman.

---

## 14. Required Project Deliverables

1. Complete source code in GitHub.
2. Working Angular frontend.
3. Working Node.js and Express backend.
4. MongoDB schemas and collection documentation.
5. Synthetic seed data.
6. Postman API collection.
7. README with prerequisites, environment variables, and setup instructions.
8. Architecture diagram.
9. Database relationship diagram.
10. Doctor, Patient, and Pharmacy dashboard screenshots or walkthrough.
11. Demonstration of the complete workflow:

Patient Assignment → Consultation → Prescription → Pharmacy Dispensing → Follow-up Review → Reminder.

12. Demonstration of access control and security.
13. Known limitations and future enhancements.

---

## 15. Development Instructions for Antigravity

You are acting as a senior full-stack software engineer assisting in the development of this internship project.

Follow these instructions throughout the project:

1. Treat this document as the central project context.
2. Follow the mentor-provided BRD as the primary source of truth.
3. Use the specified MEAN Stack.
4. Never change Angular to React without explicit approval.
5. Maintain a clean, modular, maintainable folder structure.
6. Separate frontend, backend, database, and business logic.
7. Never generate the entire application in one step.
8. Develop one module at a time.
9. Before implementing a module, explain its purpose, files involved, dependencies, and implementation plan.
10. Implement backend APIs before integrating their frontend features.
11. Test each module before moving to the next module.
12. Reuse existing components, services, models, and utilities wherever possible.
13. Avoid duplicate files, duplicate functions, and unnecessary dependencies.
14. Follow consistent naming conventions.
15. Add meaningful comments only where necessary.
16. Implement backend authorization for every protected resource.
17. Validate all API inputs.
18. Never use real patient information.
19. Do not hardcode secrets or credentials.
20. Keep the application runnable after each completed development module.
21. Do not overwrite working code without understanding its existing functionality.
22. Explain any architectural changes before implementing them.
23. Maintain API documentation and update the README.
24. Use meaningful Git commits after completing and testing each module.
25. If a requirement is ambiguous, identify the ambiguity and ask for clarification instead of inventing business rules.

### Git Commit Guidelines

Use meaningful, incremental commits.

Suggested commit message examples:

- chore: initialize project structure
- chore: configure backend environment
- chore: initialize Angular frontend
- feat: implement MongoDB connection
- feat: implement JWT authentication
- feat: add role-based authorization
- feat: implement patient management
- feat: implement doctor assignments
- feat: implement medical history
- feat: implement review scheduling
- feat: add prescription management
- feat: implement pharmacy inventory
- feat: add patient-doctor messaging
- feat: implement secure document vault
- test: add API and authorization tests
- docs: complete project documentation

Only commit code that has been reviewed and tested to the extent appropriate for that module.

---

## 16. Important Project Constraints

- Project duration is limited to 15 working days.
- This is an educational internship prototype.
- Use synthetic/demo patient information only.
- The application is intended for a single hospital/organization.
- Payments, insurance claims, billing, laboratory integration, radiology integration, inpatient/bed management, emergency dispatch, AI diagnosis, and native mobile applications are outside the specified project scope.
- Email/SMS notifications are optional; in-app reminders are mandatory.
- Production deployment and regulatory certification are not included.
- All sensitive access must be authorized and auditable.

---

## 17. Final Development Objective

Build a functional, modular Smart Hospital Management System using Angular, Node.js, Express.js, and MongoDB.

The final application must provide secure, role-specific experiences for doctors, patients, and pharmacy staff.

The most important objective is to demonstrate continuity of patient care through:

Patient Management → Doctor Assignment → Medical Consultation → Prescription Creation → Pharmacy Dispensing → Follow-up Scheduling → Patient Notification.

The implementation must prioritize security, data integrity, maintainability, testing, and completion within the internship timeline.

**This project_context.md must be consulted before generating or modifying project code.**

26. Always refer to docs/Smart_Hospital_Management_System_BRD.pdf
    when implementing or modifying project requirements.

27. If project_context.md and the original BRD appear to conflict,
    identify the conflict and ask for clarification rather than
    silently choosing one.

28. Do not introduce features outside the agreed project scope
    without approval.