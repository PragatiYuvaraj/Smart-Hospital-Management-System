import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { User, UserStatus, UserRole } from '../models/user.model';

export interface CreateUserRequest {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  permissions?: string[];
}

export interface CreateUserResponse {
  success: boolean;
  message: string;
  data: { user: User };
}

export interface ListUsersResponse {
  success: boolean;
  message: string;
  data: {
    users: User[];
    total: number;
  };
}

export interface UpdateUserStatusRequest {
  status: UserStatus;
}

export interface UpdateUserPermissionsRequest {
  permissions: string[];
}

export interface UpdateUserResponse {
  success: boolean;
  message: string;
  data: { user: User };
}

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private readonly apiUrl = `${environment.apiUrl}/users`;

  constructor(private http: HttpClient) {}

  /** POST /api/users – create a staff account */
  createUser(payload: CreateUserRequest): Observable<CreateUserResponse> {
    return this.http.post<CreateUserResponse>(this.apiUrl, payload);
  }

  /** GET /api/users – list users with optional query filters */
  listUsers(params?: {
    role?: UserRole;
    status?: UserStatus;
    search?: string;
    page?: number;
    limit?: number;
  }): Observable<ListUsersResponse> {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) {
          query.append(k, String(v));
        }
      });
    }
    const url = query.toString() ? `${this.apiUrl}?${query}` : this.apiUrl;
    return this.http.get<ListUsersResponse>(url);
  }

  /** PATCH /api/users/:id/status – activate/deactivate */
  updateUserStatus(userId: string, payload: UpdateUserStatusRequest): Observable<UpdateUserResponse> {
    return this.http.patch<UpdateUserResponse>(`${this.apiUrl}/${encodeURIComponent(userId)}/status`, payload);
  }

  /** PATCH /api/users/:id/permissions – replace permissions array */
  updateUserPermissions(userId: string, payload: UpdateUserPermissionsRequest): Observable<UpdateUserResponse> {
    return this.http.patch<UpdateUserResponse>(`${this.apiUrl}/${encodeURIComponent(userId)}/permissions`, payload);
  }
}
