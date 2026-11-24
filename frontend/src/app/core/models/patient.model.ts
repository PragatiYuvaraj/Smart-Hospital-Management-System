export interface PatientProfile {
  _id: string;
  userId: string;
  patientNumber: string;
  name: string;
  dateOfBirth: string;
  contactNumber?: string;
  address?: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt?: string;
  updatedAt?: string;
}

export interface PatientProfileResponse {
  success: boolean;
  message: string;
  data: {
    patient: PatientProfile;
  };
}

export interface UpdatePatientProfileRequest {
  contactNumber?: string;
  address?: string;
}
