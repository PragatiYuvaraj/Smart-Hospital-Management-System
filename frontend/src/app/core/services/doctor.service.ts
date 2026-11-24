import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  DoctorProfileResponse,
  AssignedPatientsResponse,
  VisiblePatientDetailResponse,
  HospitalPatientsResponse
} from '../models/doctor.model';

@Injectable({
  providedIn: 'root'
})
export class DoctorService {
  private readonly doctorsApiUrl = `${environment.apiUrl}/doctors`;
  private readonly assignmentsApiUrl = `${environment.apiUrl}/assignments`;
  private readonly patientsApiUrl = `${environment.apiUrl}/patients`;

  constructor(private http: HttpClient) {}

  /**
   * Retrieves the authenticated doctor's profile
   * GET /api/doctors/me
   */
  getMyProfile(): Observable<DoctorProfileResponse> {
    return this.http.get<DoctorProfileResponse>(`${this.doctorsApiUrl}/me`);
  }

  /**
   * Retrieves assigned patients for a specific doctor
   * GET /api/assignments/doctor/:doctorId/patients
   */
  getDoctorPatients(doctorId: string): Observable<AssignedPatientsResponse> {
    return this.http.get<AssignedPatientsResponse>(
      `${this.assignmentsApiUrl}/doctor/${encodeURIComponent(doctorId)}/patients`
    );
  }

  /**
   * Retrieves visible patients (hospital-wide for DUTY_DOCTOR or assigned only for regular DOCTOR)
   * GET /api/patients?search=...
   */
  getHospitalPatients(search?: string): Observable<HospitalPatientsResponse> {
    const params = search && search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
    return this.http.get<HospitalPatientsResponse>(`${this.patientsApiUrl}${params}`);
  }

  /**
   * Retrieves an authorized patient profile detail
   * GET /api/patients/:id
   */
  getPatientDetail(patientId: string): Observable<VisiblePatientDetailResponse> {
    return this.http.get<VisiblePatientDetailResponse>(
      `${this.patientsApiUrl}/${encodeURIComponent(patientId)}`
    );
  }

  /**
   * Retrieves a doctor profile by ID (available to any authenticated user)
   * GET /api/doctors/:id
   */
  getDoctorById(doctorId: string): Observable<DoctorProfileResponse> {
    return this.http.get<DoctorProfileResponse>(
      `${this.doctorsApiUrl}/${encodeURIComponent(doctorId)}`
    );
  }
}
