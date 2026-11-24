import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  PatientProfileResponse,
  UpdatePatientProfileRequest
} from '../models/patient.model';

export interface PatientAssignmentResponse {
  success: boolean;
  message: string;
  data: {
    assignment: {
      _id: string;
      patientId: string;
      doctorId: string;
      assignmentType: string;
      startDate: string;
      endDate: string | null;
      status: string;
    } | null;
  };
}

@Injectable({
  providedIn: 'root'
})
export class PatientService {
  private readonly apiUrl = `${environment.apiUrl}/patients`;
  private readonly assignmentsUrl = `${environment.apiUrl}/assignments`;

  constructor(private http: HttpClient) {}

  /**
   * Retrieves the authenticated patient's profile
   * GET /api/patients/me
   */
  getMyProfile(): Observable<PatientProfileResponse> {
    return this.http.get<PatientProfileResponse>(`${this.apiUrl}/me`);
  }

  /**
   * Updates permitted fields (contactNumber, address) on the patient's profile
   * PATCH /api/patients/me
   */
  updateMyProfile(payload: UpdatePatientProfileRequest): Observable<PatientProfileResponse> {
    return this.http.patch<PatientProfileResponse>(`${this.apiUrl}/me`, payload);
  }

  /**
   * Retrieves the patient's treating-doctor assignment
   * GET /api/assignments/patient/:patientId
   */
  getPatientAssignment(patientId: string): Observable<PatientAssignmentResponse> {
    return this.http.get<PatientAssignmentResponse>(
      `${this.assignmentsUrl}/patient/${encodeURIComponent(patientId)}`
    );
  }
}
