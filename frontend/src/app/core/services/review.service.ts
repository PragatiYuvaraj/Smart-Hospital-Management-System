import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  CreateReviewRequest,
  HospitalTimezoneResponse,
  RescheduleReviewRequest,
  ReviewListResponse,
  ReviewResponse
} from '../models/review.model';

@Injectable({
  providedIn: 'root'
})
export class ReviewService {
  private readonly reviewsApiUrl = `${environment.apiUrl}/reviews`;
  private readonly healthApiUrl = `${environment.apiUrl}/health`;

  constructor(private http: HttpClient) {}

  getHospitalTimezone(): Observable<HospitalTimezoneResponse> {
    return this.http.get<HospitalTimezoneResponse>(this.healthApiUrl);
  }

  getUpcomingReviews(
    patientId: string,
    page = 1,
    limit = 20
  ): Observable<ReviewListResponse> {
    return this.requestUpcomingReviews(patientId, page, limit);
  }

  getMyUpcomingReviews(page = 1, limit = 20): Observable<ReviewListResponse> {
    return this.requestUpcomingReviews(undefined, page, limit);
  }

  createReview(payload: CreateReviewRequest): Observable<ReviewResponse> {
    return this.http.post<ReviewResponse>(this.reviewsApiUrl, payload);
  }

  rescheduleReview(
    reviewId: string,
    payload: RescheduleReviewRequest
  ): Observable<ReviewResponse> {
    return this.http.patch<ReviewResponse>(
      `${this.reviewsApiUrl}/${encodeURIComponent(reviewId)}/reschedule`,
      payload
    );
  }

  cancelReview(reviewId: string): Observable<ReviewResponse> {
    return this.http.post<ReviewResponse>(
      `${this.reviewsApiUrl}/${encodeURIComponent(reviewId)}/cancel`,
      null
    );
  }

  completeReview(reviewId: string): Observable<ReviewResponse> {
    return this.http.post<ReviewResponse>(
      `${this.reviewsApiUrl}/${encodeURIComponent(reviewId)}/complete`,
      null
    );
  }

  private requestUpcomingReviews(
    patientId: string | undefined,
    page: number,
    limit: number
  ): Observable<ReviewListResponse> {
    let params = new HttpParams().set('page', page).set('limit', limit);
    if (patientId) params = params.set('patientId', patientId);
    return this.http.get<ReviewListResponse>(`${this.reviewsApiUrl}/upcoming`, { params });
  }
}
