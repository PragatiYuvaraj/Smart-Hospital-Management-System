// Medical Records domain TypeScript interfaces — mirrors backend medicalRecord.service.js response shapes

export type ConsultationStatus = 'DRAFT' | 'FINALIZED';

export interface DoctorReference {
  _id: string;
  name: string;
  specialization?: string;
}

export interface PatientReference {
  _id: string;
  name: string;
  patientNumber: string;
}

export interface MedicalRecordAmendment {
  _id?: string;
  authorId?: string;
  authorDoctorId?: string;
  authorName: string;
  reason: string;
  changes: string;
  createdAt: string;
}

export interface PatientMedicalRecordAmendment {
  authorName: string;
  reason: string;
  changes: string;
  createdAt: string;
}

export interface PatientDoctorReference {
  name: string;
  specialization?: string;
}

/**
 * Patient-facing medical record interface.
 * Excludes internal clinical notes and confidential database identifiers.
 * Only finalized and released consultations are returned to patients.
 */
export interface PatientMedicalRecord {
  _id: string;
  encounterDate: string;
  reason: string;
  symptoms: string;
  observations?: string;
  diagnosis: string;
  treatmentPlan: string;
  doctor?: PatientDoctorReference | null;
  amendments: PatientMedicalRecordAmendment[];
}

/**
 * Full clinical consultation record for authorized doctors.
 * Includes clinical notes, release flags, timestamps, and patient/doctor references.
 */
export interface MedicalRecord extends PatientMedicalRecord {
  doctor?: DoctorReference | null;
  amendments: MedicalRecordAmendment[];
  patientId: string;
  patient?: PatientReference | null;
  doctorId: string;
  notes?: string; // Internal clinical notes (restricted to DOCTOR)
  status: ConsultationStatus;
  isReleased: boolean;
  releasedAt?: string | null;
  releasedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

// Paginated consultation history response
export interface MedicalRecordListResponse<T = MedicalRecord | PatientMedicalRecord> {
  records: T[];
  total: number;
  page: number;
  totalPages: number;
}

export type DoctorMedicalRecordListResponse = MedicalRecordListResponse<MedicalRecord>;
export type PatientMedicalRecordListResponse = MedicalRecordListResponse<PatientMedicalRecord>;

// Request Payloads
export interface CreateConsultationRequest {
  patientId: string;
  encounterDate?: string;
  reason: string;
  symptoms: string;
  observations?: string;
  diagnosis: string;
  treatmentPlan: string;
  notes?: string;
  status?: ConsultationStatus;
  isReleased?: boolean;
}

export interface UpdateConsultationRequest {
  reason?: string;
  symptoms?: string;
  observations?: string;
  diagnosis?: string;
  treatmentPlan?: string;
  notes?: string;
  status?: ConsultationStatus;
  isReleased?: boolean;
}

export interface FinalizeConsultationRequest {
  isReleased?: boolean;
}

export interface ReleaseConsultationRequest {
  isReleased: boolean;
}

export interface CreateAmendmentRequest {
  reason: string;
  changes: string;
  expectedVersion?: number;
}

// Prescription Linkage Requests (issued by DOCTOR during consultation)
export interface PrescriptionItemRequest {
  medicineId: string;
  dosage: string;
  route?: string;
  frequency: string;
  duration: string;
  quantity: number;
  instructions?: string;
}

export interface CreatePrescriptionRequest {
  medicalRecordId: string;
  patientId?: string;
  items: PrescriptionItemRequest[];
}

export interface CreatedPrescriptionItem {
  _id?: string;
  medicineId: string;
  dosage: string;
  route?: string;
  frequency: string;
  duration: string;
  quantity: number;
  dispensedQuantity?: number;
  instructions?: string;
}

export interface CreatedPrescription {
  _id: string;
  patientId: string;
  doctorId: string;
  medicalRecordId: string;
  items: CreatedPrescriptionItem[];
  status: 'PENDING' | 'PARTIALLY_DISPENSED' | 'DISPENSED' | 'CANCELLED';
  issuedAt: string;
  createdAt?: string;
}

// General API response envelope
export interface MedicalRecordApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}
