export interface AssignmentPatientSummary {
  _id: string;
  name: string;
  patientNumber: string;
  contactNumber?: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface AssignmentDoctorSummary {
  _id: string;
  name: string;
  doctorNumber: string;
  specialization: string;
  department: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface DoctorAssignmentItem {
  _id: string;
  patientId: string;
  doctorId: string;
  status: 'ACTIVE' | 'CLOSED';
  type: string;
  startDate: string;
  endDate?: string | null;
  assignedBy?: string;
  createdAt?: string;
  updatedAt?: string;
  patient?: AssignmentPatientSummary | null;
  doctor?: AssignmentDoctorSummary | null;
}

export interface ListAssignmentsResponse {
  success: boolean;
  message: string;
  data: {
    assignments: DoctorAssignmentItem[];
  };
}

export interface CreateAssignmentPayload {
  patientId: string;
  doctorId: string;
  startDate?: string;
}

export interface CreateAssignmentResponse {
  success: boolean;
  message: string;
  data: {
    assignment: DoctorAssignmentItem;
  };
}

export interface ReassignPayload {
  doctorId: string;
  startDate?: string;
}

export interface ReassignResponse {
  success: boolean;
  message: string;
  data: {
    assignment: DoctorAssignmentItem;
  };
}

export interface ActiveDoctorsResponse {
  success: boolean;
  message: string;
  data: {
    doctors: AssignmentDoctorSummary[];
  };
}
