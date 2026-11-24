import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  CreateAmendmentRequest,
  CreateConsultationRequest,
  CreatePrescriptionRequest,
  CreatedPrescription,
  FinalizeConsultationRequest,
  DoctorReference,
  MedicalRecord,
  MedicalRecordAmendment,
  MedicalRecordApiResponse,
  MedicalRecordListResponse,
  PatientMedicalRecord,
  PatientMedicalRecordAmendment,
  ReleaseConsultationRequest,
  UpdateConsultationRequest
} from '../models/medical-record.model';

export interface MedicalRecordListQuery {
  page?: number;
  limit?: number;
  status?: 'DRAFT' | 'FINALIZED';
}

type PatientMedicalRecordApiView = Omit<PatientMedicalRecord, 'doctor' | 'amendments'> & {
  doctor?: DoctorReference | null;
  amendments: MedicalRecordAmendment[];
};

@Injectable({
  providedIn: 'root'
})
export class MedicalRecordService {
  private readonly medicalRecordsUrl = `${environment.apiUrl}/medical-records`;
  private readonly prescriptionsUrl = `${environment.apiUrl}/prescriptions`;
  private readonly patientsUrl = `${environment.apiUrl}/patients`;

  constructor(private http: HttpClient) {}

  /**
   * POST /api/medical-records
   * Creates a consultation as an authorized doctor.
   */
  createConsultation(
    payload: CreateConsultationRequest
  ): Observable<MedicalRecordApiResponse<MedicalRecord>> {
    return this.http.post<MedicalRecordApiResponse<MedicalRecord>>(
      this.medicalRecordsUrl,
      payload
    );
  }

  /**
   * GET /api/patients/:id/medical-records
   * Returns only patient-visible fields; internal clinical notes are not included.
   */
  getPatientMedicalRecords(
    patientId: string,
    query: MedicalRecordListQuery = {}
  ): Observable<MedicalRecordApiResponse<MedicalRecordListResponse<PatientMedicalRecord>>> {
    return this.http.get<
      MedicalRecordApiResponse<MedicalRecordListResponse<PatientMedicalRecordApiView>>
    >(this.getPatientRecordsUrl(patientId), { params: this.createListParams(query) }).pipe(
      map((response) => ({
        ...response,
        data: {
          ...response.data,
          records: response.data.records.map((record) => this.toPatientMedicalRecord(record))
        }
      }))
    );
  }

  /**
   * GET /api/patients/:id/medical-records
   * Returns the full clinical history to an authorized doctor.
   */
  getPatientMedicalRecordsForDoctor(
    patientId: string,
    query: MedicalRecordListQuery = {}
  ): Observable<MedicalRecordApiResponse<MedicalRecordListResponse<MedicalRecord>>> {
    return this.http.get<
      MedicalRecordApiResponse<MedicalRecordListResponse<MedicalRecord>>
    >(this.getPatientRecordsUrl(patientId), { params: this.createListParams(query) });
  }

  /**
   * GET /api/medical-records/:id
   * Returns full clinical detail to an authorized doctor.
   */
  getMedicalRecord(
    recordId: string
  ): Observable<MedicalRecordApiResponse<MedicalRecord>> {
    return this.http.get<MedicalRecordApiResponse<MedicalRecord>>(
      `${this.medicalRecordsUrl}/${encodeURIComponent(recordId)}`
    );
  }

  /**
   * GET /api/medical-records/:id
   * Returns only patient-visible fields; internal clinical notes are not included.
   */
  getPatientMedicalRecord(
    recordId: string
  ): Observable<MedicalRecordApiResponse<PatientMedicalRecord>> {
    return this.http.get<MedicalRecordApiResponse<PatientMedicalRecordApiView>>(
      `${this.medicalRecordsUrl}/${encodeURIComponent(recordId)}`
    ).pipe(
      map((response) => ({
        ...response,
        data: this.toPatientMedicalRecord(response.data)
      }))
    );
  }

  /**
   * PATCH /api/medical-records/:id
   * Updates an author's draft consultation.
   */
  updateDraftConsultation(
    recordId: string,
    payload: UpdateConsultationRequest
  ): Observable<MedicalRecordApiResponse<MedicalRecord>> {
    return this.http.patch<MedicalRecordApiResponse<MedicalRecord>>(
      `${this.medicalRecordsUrl}/${encodeURIComponent(recordId)}`,
      payload
    );
  }

  /**
   * POST /api/medical-records/:id/finalize
   */
  finalizeConsultation(
    recordId: string,
    payload: FinalizeConsultationRequest = {}
  ): Observable<MedicalRecordApiResponse<MedicalRecord>> {
    return this.http.post<MedicalRecordApiResponse<MedicalRecord>>(
      `${this.medicalRecordsUrl}/${encodeURIComponent(recordId)}/finalize`,
      payload
    );
  }

  /**
   * POST /api/medical-records/:id/release
   */
  setPatientRelease(
    recordId: string,
    payload: ReleaseConsultationRequest
  ): Observable<MedicalRecordApiResponse<MedicalRecord>> {
    return this.http.post<MedicalRecordApiResponse<MedicalRecord>>(
      `${this.medicalRecordsUrl}/${encodeURIComponent(recordId)}/release`,
      payload
    );
  }

  /**
   * POST /api/medical-records/:id/amendments
   */
  addAmendment(
    recordId: string,
    payload: CreateAmendmentRequest
  ): Observable<MedicalRecordApiResponse<MedicalRecord>> {
    return this.http.post<MedicalRecordApiResponse<MedicalRecord>>(
      `${this.medicalRecordsUrl}/${encodeURIComponent(recordId)}/amendments`,
      payload
    );
  }

  /**
   * POST /api/prescriptions
   * Creates a prescription linked to a finalized consultation.
   */
  createPrescription(
    payload: CreatePrescriptionRequest
  ): Observable<MedicalRecordApiResponse<CreatedPrescription>> {
    return this.http.post<MedicalRecordApiResponse<CreatedPrescription>>(
      this.prescriptionsUrl,
      payload
    );
  }

  /**
   * GET /api/prescriptions/my
   * Retrieves released prescriptions for the logged-in patient.
   */
  getMyPrescriptions(): Observable<{ success: boolean; message: string; data: { prescriptions: any[] } }> {
    return this.http.get<{ success: boolean; message: string; data: { prescriptions: any[] } }>(
      `${this.prescriptionsUrl}/my`
    );
  }

  private getPatientRecordsUrl(patientId: string): string {
    return `${this.patientsUrl}/${encodeURIComponent(patientId)}/medical-records`;
  }

  private createListParams(query: MedicalRecordListQuery): HttpParams {
    let params = new HttpParams();
    if (query.page !== undefined) params = params.set('page', String(query.page));
    if (query.limit !== undefined) params = params.set('limit', String(query.limit));
    if (query.status !== undefined) params = params.set('status', query.status);
    return params;
  }

  private toPatientMedicalRecord(record: PatientMedicalRecordApiView): PatientMedicalRecord {
    const doctor = record.doctor
      ? { name: record.doctor.name, specialization: record.doctor.specialization }
      : null;
    const amendments: PatientMedicalRecordAmendment[] = record.amendments.map(
      ({ authorName, reason, changes, createdAt }) => ({
        authorName,
        reason,
        changes,
        createdAt
      })
    );

    return {
      _id: record._id,
      encounterDate: record.encounterDate,
      reason: record.reason,
      symptoms: record.symptoms,
      observations: record.observations,
      diagnosis: record.diagnosis,
      treatmentPlan: record.treatmentPlan,
      doctor,
      amendments
    };
  }
}
