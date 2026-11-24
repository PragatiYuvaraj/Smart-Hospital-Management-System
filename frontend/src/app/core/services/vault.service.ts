import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  VaultDocumentDeleteResponse,
  VaultDocumentListResponse,
  VaultDocumentUploadResponse
} from '../models/vault.model';

@Injectable({
  providedIn: 'root'
})
export class VaultService {
  private readonly vaultApiUrl = `${environment.apiUrl}/vault/documents`;

  constructor(private http: HttpClient) {}

  /**
   * Retrieves paginated documents belonging to the authenticated doctor
   * GET /api/vault/documents?page=&limit=
   */
  getDocuments(page = 1, limit = 20): Observable<VaultDocumentListResponse> {
    const params = new HttpParams()
      .set('page', String(page))
      .set('limit', String(limit));

    return this.http.get<VaultDocumentListResponse>(this.vaultApiUrl, { params });
  }

  /**
   * Uploads a document using multipart/form-data with field name "file"
   * POST /api/vault/documents
   * Notice: We do NOT set Content-Type header so the browser sets the boundary automatically.
   */
  uploadDocument(file: File): Observable<VaultDocumentUploadResponse> {
    const formData = new FormData();
    formData.append('file', file, file.name);

    return this.http.post<VaultDocumentUploadResponse>(this.vaultApiUrl, formData);
  }

  /**
   * Downloads a document file as a Blob
   * GET /api/vault/documents/:id/download
   */
  downloadDocument(documentId: string): Observable<Blob> {
    return this.http.get(`${this.vaultApiUrl}/${encodeURIComponent(documentId)}/download`, {
      responseType: 'blob'
    });
  }

  /**
   * Soft-deletes a document
   * DELETE /api/vault/documents/:id
   */
  deleteDocument(documentId: string): Observable<VaultDocumentDeleteResponse> {
    return this.http.delete<VaultDocumentDeleteResponse>(
      `${this.vaultApiUrl}/${encodeURIComponent(documentId)}`
    );
  }
}
