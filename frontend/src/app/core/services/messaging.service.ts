import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ConversationListResponse,
  ConversationResponse,
  MessageListResponse,
  MessageResponse
} from '../models/messaging.model';

@Injectable({
  providedIn: 'root'
})
export class MessagingService {
  private readonly conversationsUrl = `${environment.apiUrl}/conversations`;

  constructor(private http: HttpClient) {}

  createOrGetConversation(patientId?: string | null): Observable<ConversationResponse> {
    const body = patientId ? { patientId } : {};
    return this.http.post<ConversationResponse>(this.conversationsUrl, body);
  }

  getConversations(page = 1, limit = 20): Observable<ConversationListResponse> {
    const params = new HttpParams()
      .set('page', page)
      .set('limit', limit);
    return this.http.get<ConversationListResponse>(this.conversationsUrl, { params });
  }

  getMessages(
    conversationId: string,
    page = 1,
    limit = 20
  ): Observable<MessageListResponse> {
    const params = new HttpParams()
      .set('page', page)
      .set('limit', limit);
    return this.http.get<MessageListResponse>(
      `${this.conversationsUrl}/${encodeURIComponent(conversationId)}/messages`,
      { params }
    );
  }

  sendMessage(conversationId: string, body: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(
      `${this.conversationsUrl}/${encodeURIComponent(conversationId)}/messages`,
      { body }
    );
  }

  markMessageAsRead(
    conversationId: string,
    messageId: string
  ): Observable<MessageResponse> {
    return this.http.patch<MessageResponse>(
      `${this.conversationsUrl}/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/read`,
      {}
    );
  }
}
