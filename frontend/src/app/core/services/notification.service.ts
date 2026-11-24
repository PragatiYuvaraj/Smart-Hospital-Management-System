import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  NotificationListResponse,
  NotificationResponse
} from '../models/notification.model';

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private readonly notificationsApiUrl = `${environment.apiUrl}/notifications`;

  constructor(private http: HttpClient) {}

  getMyNotifications(page = 1, limit = 20): Observable<NotificationListResponse> {
    const params = new HttpParams().set('page', page).set('limit', limit);
    return this.http.get<NotificationListResponse>(
      `${this.notificationsApiUrl}/my`,
      { params }
    );
  }

  markAsRead(notificationId: string): Observable<NotificationResponse> {
    return this.http.patch<NotificationResponse>(
      `${this.notificationsApiUrl}/${encodeURIComponent(notificationId)}/read`,
      null
    );
  }
}
