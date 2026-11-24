import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  PrescriptionListResponse,
  MedicineListResponse,
  MedicineAvailabilityResponse,
  DispensingRequest,
  DispensingResponse,
  StockReceiptRequest,
  StockReceiptResponse
} from '../models/pharmacy.model';

export interface PharmacyApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

export interface PrescriptionListQuery {
  page?: number;
  limit?: number;
  search?: string;
}

export interface MedicineListQuery {
  page?: number;
  limit?: number;
  search?: string;
}

export interface MedicineAvailabilityQuery {
  page?: number;
  limit?: number;
  search?: string;
  medicineId?: string;
}

@Injectable({
  providedIn: 'root'
})
export class PharmacyService {
  private readonly prescriptionsUrl = `${environment.apiUrl}/prescriptions`;
  private readonly medicinesUrl     = `${environment.apiUrl}/medicines`;
  private readonly dispensingUrl    = `${environment.apiUrl}/dispensing`;
  private readonly stockUrl         = `${environment.apiUrl}/stock`;

  constructor(private http: HttpClient) {}

  /**
   * GET /api/prescriptions/pending
   * Returns paginated PENDING and PARTIALLY_DISPENSED prescriptions.
   * PHARMACY role only.
   */
  getPendingPrescriptions(
    query: PrescriptionListQuery = {}
  ): Observable<PharmacyApiResponse<PrescriptionListResponse>> {
    let params = new HttpParams();
    if (query.page)   params = params.set('page',   String(query.page));
    if (query.limit)  params = params.set('limit',  String(query.limit));
    if (query.search) params = params.set('search', query.search);
    return this.http.get<PharmacyApiResponse<PrescriptionListResponse>>(
      `${this.prescriptionsUrl}/pending`,
      { params }
    );
  }

  /**
   * GET /api/medicines
   * Returns paginated medicine catalogue (active medicines with usable quantity summary).
   * PHARMACY role only.
   */
  getMedicines(
    query: MedicineListQuery = {}
  ): Observable<PharmacyApiResponse<MedicineListResponse>> {
    let params = new HttpParams();
    if (query.page)   params = params.set('page',   String(query.page));
    if (query.limit)  params = params.set('limit',  String(query.limit));
    if (query.search) params = params.set('search', query.search);
    return this.http.get<PharmacyApiResponse<MedicineListResponse>>(
      this.medicinesUrl,
      { params }
    );
  }

  /**
   * GET /api/medicines/availability
   * Returns medicines with per-batch stock breakdown (expired/usable quantities, batch list).
   * PHARMACY role only.
   */
  getMedicineAvailability(
    query: MedicineAvailabilityQuery = {}
  ): Observable<PharmacyApiResponse<MedicineAvailabilityResponse>> {
    let params = new HttpParams();
    if (query.page)       params = params.set('page',       String(query.page));
    if (query.limit)      params = params.set('limit',      String(query.limit));
    if (query.search)     params = params.set('search',     query.search);
    if (query.medicineId) params = params.set('medicineId', query.medicineId);
    return this.http.get<PharmacyApiResponse<MedicineAvailabilityResponse>>(
      `${this.medicinesUrl}/availability`,
      { params }
    );
  }

  /**
   * POST /api/dispensing
   * Records a dispensing event against a prescription.
   * Validates: prescription must be PENDING/PARTIALLY_DISPENSED, batches must not be expired,
   * quantities must not exceed available stock.
   * PHARMACY role only.
   */
  recordDispensing(
    payload: DispensingRequest
  ): Observable<PharmacyApiResponse<DispensingResponse>> {
    return this.http.post<PharmacyApiResponse<DispensingResponse>>(
      this.dispensingUrl,
      payload
    );
  }

  /**
   * POST /api/stock/receipts
   * Records an incoming stock receipt (new medicine batch or top-up).
   * Creates a MedicineBatch and a StockTransaction.
   * PHARMACY role only.
   */
  recordStockReceipt(
    payload: StockReceiptRequest
  ): Observable<PharmacyApiResponse<StockReceiptResponse>> {
    return this.http.post<PharmacyApiResponse<StockReceiptResponse>>(
      `${this.stockUrl}/receipts`,
      payload
    );
  }
}
