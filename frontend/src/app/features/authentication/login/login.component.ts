import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {
  email = '';
  password = '';
  isLoading = false;
  errorMessage = '';

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  onSubmit(): void {
    if (!this.email || !this.password) {
      this.errorMessage = 'Please enter both email and password.';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    this.authService.login({ email: this.email, password: this.password }).subscribe({
      next: (res) => {
        this.isLoading = false;
        if (res.success) {
          this.router.navigate(['/dashboard']);
        }
      },
      error: (err) => {
        this.isLoading = false;
        this.errorMessage = err.error?.message || 'Login failed. Please check your credentials.';
      }
    });
  }

  // Helper buttons to quickly test demonstration accounts
  fillDemo(role: 'DOCTOR' | 'PHARMACY' | 'PATIENT'): void {
    switch (role) {
      case 'DOCTOR':
        this.email = 'doctor@smarthospital.local';
        this.password = 'Doctor@123';
        break;
      case 'PHARMACY':
        this.email = 'pharmacy@smarthospital.local';
        this.password = 'Pharmacy@123';
        break;
      case 'PATIENT':
        this.email = 'patient@smarthospital.local';
        this.password = 'Patient@123';
        break;
    }
    this.errorMessage = '';
  }
}
