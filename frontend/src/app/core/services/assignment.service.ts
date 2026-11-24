import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ListAssignmentsResponse,
  CreateAssignmentPayload,
  CreateAssignmentResponse,
  ReassignPayload,
  ReassignResponse,
  ActiveDoctorsResponse
} from '../models/assignment.model';
import { HospitalPatientsResponse } from '../models/doctor.model';

@Injectable({
  providedIn: 'root'
})
export class AssignmentService {
  private readonly apiUrl = `${environment.apiUrl}/assignments`;
  private readonly doctorsUrl = `${environment.apiUrl}/doctors`;
  private readonly patientsUrl = `${environment.apiUrl}/patients`;

  constructor(private http: HttpClient) {}

  /**
   * Retrieves all assignments (filtered optionally by status, patientId, or doctorId)
   * GET /api/assignments
   */
  getAssignments(filter?: { status?: string; patientId?: string; doctorId?: string }): Observable<ListAssignmentsResponse> {
    let params = new HttpParams();
    if (filter?.status) {
      params = params.set('status', filter.status);
    }
    if (filter?.patientId) {
      params = params.set('patientId', filter.patientId);
    }
    if (filter?.doctorId) {
      params = params.set('doctorId', filter.doctorId);
    }
    return this.http.get<ListAssignmentsResponse>(this.apiUrl, { params });
  }

  /**
   * Assigns a patient to a doctor
   * POST /api/assignments
   */
  createAssignment(payload: CreateAssignmentPayload): Observable<CreateAssignmentResponse> {
    return this.http.post<CreateAssignmentResponse>(this.apiUrl, payload);
  }

  /**
   * Reassigns an existing active assignment to a different doctor
   * PATCH /api/assignments/:id/reassign
   */
  reassign(assignmentId: string, payload: ReassignPayload): Observable<ReassignResponse> {
    return this.http.patch<ReassignResponse>(
      `${this.apiUrl}/${encodeURIComponent(assignmentId)}/reassign`,
      payload
    );
  }

  /**
   * Retrieves active doctors for assignment dropdowns
   * GET /api/doctors
   */
  getActiveDoctors(): Observable<ActiveDoctorsResponse> {
    return this.http.get<ActiveDoctorsResponse>(this.doctorsUrl);
  }

  /**
   * Retrieves hospital patients for assignment dropdowns
   * GET /api/patients
   */
  getHospitalPatients(search?: string): Observable<HospitalPatientsResponse> {
    let params = new HttpParams();
    if (search && search.trim()) {
      params = params.set('search', search.trim());
    }
    return this.http.get<HospitalPatientsResponse>(this.patientsUrl, { params });
  }
}
