import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  BehaviorSubject,
  Observable,
  catchError,
  finalize,
  map,
  of,
  shareReplay,
  tap,
  throwError
} from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  AuthResponse,
  LoginRequest,
  ProfileResponse,
  RegisterRequest,
  User,
  UserRole
} from '../models/user.model';

/**
 * =========================================================================
 * Authentication Service
 * =========================================================================
 * Security Note:
 * For this educational internship prototype, browser localStorage is utilized
 * to persist the JWT access token across page refreshes.
 *
 * Limitation Notice (XSS Consideration):
 * In a production hospital environment subject to HIPAA/GDPR, storing tokens
 * in localStorage is vulnerable to Cross-Site Scripting (XSS). An enterprise
 * deployment should transition to HttpOnly, SameSite=Strict cookies with CSRF
 * protection. For this prototype, token management is strictly centralized
 * here, passwords are never stored, and tokens are wiped immediately on logout.
 * =========================================================================
 */
@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly TOKEN_KEY = 'shms_auth_token';
  private readonly USER_KEY = 'shms_user_profile';
  private readonly apiUrl = `${environment.apiUrl}/auth`;

  private currentUserSubject = new BehaviorSubject<User | null>(this.getStoredUser());
  private profileRequest: Observable<User | null> | null = null;
  private profileValidated = false;
  private sessionVersion = 0;
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor(private http: HttpClient) {}

  /**
   * Registers a new patient account
   */
  register(credentials: RegisterRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/register`, credentials).pipe(
      tap((res) => {
        if (res.success && res.data) {
          this.saveSession(res.data.token, res.data.user);
        }
      })
    );
  }

  /**
   * Logs in a user (Doctor, Patient, Pharmacy)
   */
  login(credentials: LoginRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/login`, credentials).pipe(
      tap((res) => {
        if (res.success && res.data) {
          this.saveSession(res.data.token, res.data.user);
        }
      })
    );
  }

  /**
   * Fetches the current authenticated user's profile from the backend
   */
  fetchProfile(): Observable<User | null> {
    const token = this.getToken();
    if (!token) {
      return of(null);
    }

    if (this.profileValidated) {
      return of(this.currentUserSubject.value);
    }

    if (this.profileRequest) {
      return this.profileRequest;
    }

    const sessionVersion = this.sessionVersion;
    this.profileRequest = this.http.get<ProfileResponse>(`${this.apiUrl}/me`).pipe(
      map((res) => {
        if (!res.success || !res.data?.user) {
          throw new Error('The server returned an invalid user profile.');
        }
        return res.data.user;
      }),
      map((user) => {
        if (this.sessionVersion !== sessionVersion || this.getToken() !== token) {
          return null;
        }

        this.saveUser(user);
        this.profileValidated = true;
        return user;
      }),
      catchError((error: unknown) => {
        if (this.isInvalidSessionError(error)) {
          this.logout();
          return of(null);
        }
        return throwError(() => error);
      }),
      finalize(() => {
        this.profileRequest = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    return this.profileRequest;
  }

  ensureAuthenticatedUser(): Observable<User | null> {
    return this.fetchProfile();
  }

  /**
   * Logs out the user and clears all cached tokens and profiles
   */
  logout(): void {
    this.sessionVersion++;
    this.profileValidated = false;
    this.profileRequest = null;
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    this.currentUserSubject.next(null);
  }

  /**
   * Returns the stored JWT token
   */
  getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  /**
   * Checks if user is currently authenticated
   */
  isAuthenticated(): boolean {
    return !!this.getToken() && !!this.currentUserSubject.value;
  }

  /**
   * Returns current user snapshot
   */
  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  /**
   * Returns current user's role
   */
  getUserRole(): UserRole | null {
    return this.currentUserSubject.value?.role || null;
  }

  getRoleHome(role: UserRole | null = this.getUserRole()): string {
    switch (role) {
      case 'PATIENT':
        return '/patient-dashboard';
      case 'DOCTOR':
        return '/doctor-dashboard';
      case 'PHARMACY':
        return '/pharmacy-dashboard';
      default:
        return '/login';
    }
  }

  /**
   * Checks if user possesses a specific permission
   */
  hasPermission(permission: string): boolean {
    return this.currentUserSubject.value?.permissions?.includes(permission) || false;
  }

  // --- Private Session Management Helpers ---

  private saveSession(token: string, user: User): void {
    this.sessionVersion++;
    this.profileRequest = null;
    this.profileValidated = true;
    localStorage.setItem(this.TOKEN_KEY, token);
    this.saveUser(user);
  }

  private saveUser(user: User): void {
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    this.currentUserSubject.next(user);
  }

  private isInvalidSessionError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('status' in error)) {
      return false;
    }

    const response = error as { status: number; error?: { message?: unknown } };
    const message = typeof response.error?.message === 'string'
      ? response.error.message.toLowerCase()
      : '';
    return response.status === 401 ||
      (response.status === 403 && message.startsWith('account is inactive'));
  }

  private getStoredUser(): User | null {
    try {
      const userJson = localStorage.getItem(this.USER_KEY);
      return userJson ? JSON.parse(userJson) : null;
    } catch {
      return null;
    }
  }
}
