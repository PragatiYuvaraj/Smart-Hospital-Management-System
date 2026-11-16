import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap, map, catchError, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { User, AuthResponse, ProfileResponse, LoginRequest, RegisterRequest } from '../models/user.model';

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
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor(private http: HttpClient) {
    // If a token exists on startup, refresh user profile to verify validity
    if (this.getToken()) {
      this.fetchProfile().subscribe();
    }
  }

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
    return this.http.get<ProfileResponse>(`${this.apiUrl}/me`).pipe(
      map((res) => {
        if (res.success && res.data) {
          this.currentUserSubject.next(res.data.user);
          localStorage.setItem(this.USER_KEY, JSON.stringify(res.data.user));
          return res.data.user;
        }
        return null;
      }),
      catchError(() => {
        // If token expired or invalid, clear session
        this.logout();
        return of(null);
      })
    );
  }

  /**
   * Logs out the user and clears all cached tokens and profiles
   */
  logout(): void {
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
  getUserRole(): string | null {
    return this.currentUserSubject.value?.role || null;
  }

  /**
   * Checks if user possesses a specific permission
   */
  hasPermission(permission: string): boolean {
    return this.currentUserSubject.value?.permissions?.includes(permission) || false;
  }

  // --- Private Session Management Helpers ---

  private saveSession(token: string, user: User): void {
    localStorage.setItem(this.TOKEN_KEY, token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    this.currentUserSubject.next(user);
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
