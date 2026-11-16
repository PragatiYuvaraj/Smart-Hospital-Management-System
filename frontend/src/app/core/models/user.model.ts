export type UserRole = 'DOCTOR' | 'PATIENT' | 'PHARMACY';
export type UserStatus = 'ACTIVE' | 'INACTIVE';

export interface User {
  _id: string;
  name: string;
  email: string;
  role: UserRole;
  permissions: string[];
  status: UserStatus;
  lastLoginAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthData {
  user: User;
  token: string;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  data: AuthData;
}

export interface ProfileResponse {
  success: boolean;
  message: string;
  data: {
    user: User;
  };
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
}
