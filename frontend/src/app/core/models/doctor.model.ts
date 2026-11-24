export interface DoctorProfile {
  _id: string;
  userId: string;
  doctorNumber: string;
  name: string;
  specialization: string;
  department: string;
  registrationReference: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt?: string;
  updatedAt?: string;
}

export interface DoctorProfileResponse {
  success: boolean;
  message: string;
  data: {
    doctor: DoctorProfile;
  };
}

export interface AssignedPatientSummary {
  _id: string;
  patientNumber: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  assignmentId: string;
  assignmentStartDate: string;
}

export interface AssignedPatientsResponse {
  success: boolean;
  message: string;
  data: {
    patients: AssignedPatientSummary[];
  };
}

export interface VisiblePatientDetail {
  _id: string;
  patientNumber: string;
  name: string;
  dateOfBirth?: string;
  contactNumber?: string;
  address?: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface VisiblePatientDetailResponse {
  success: boolean;
  message: string;
  data: {
    patient: VisiblePatientDetail;
  };
}

export interface PatientSummary {
  _id: string;
  patientNumber: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface HospitalPatientsResponse {
  success: boolean;
  message: string;
  data: {
    patients: PatientSummary[];
    total: number;
    page: number;
    totalPages: number;
  };
}

// New request type for creating a doctor profile
export interface CreateDoctorProfileRequest {
  userId: string;
  specialization: string;
  registrationReference: string;
  department: string;
}
