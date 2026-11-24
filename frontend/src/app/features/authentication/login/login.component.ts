import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { getAuthErrorMessage } from '../../../core/auth/auth-error.util';

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
    private router: Router,
    route: ActivatedRoute
  ) {
    if (route.snapshot.queryParamMap.has('sessionExpired')) {
      this.errorMessage = 'Your session expired. Please sign in again.';
    } else if (route.snapshot.queryParamMap.has('sessionCheckFailed')) {
      this.errorMessage = 'Your session could not be verified. Please sign in again.';
    }
  }

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
        if (res.success && res.data?.user) {
          void this.router.navigateByUrl(this.authService.getRoleHome(res.data.user.role));
        } else {
          this.errorMessage = res.message || 'Login failed. Please try again.';
        }
      },
      error: (error: unknown) => {
        this.isLoading = false;
        this.errorMessage = getAuthErrorMessage(
          error,
          'Login failed. Please check your credentials and try again.'
        );
      }
    });
  }

  // Fill the email only; the user must enter the password separately.
  fillDemo(role: 'DOCTOR' | 'PHARMACY' | 'PATIENT'): void {
    this.password = '';
    switch (role) {
      case 'DOCTOR':
        this.email = 'doctor@smarthospital.local';
        break;
      case 'PHARMACY':
        this.email = 'pharmacy@smarthospital.local';
        break;
      case 'PATIENT':
        this.email = 'patient@smarthospital.local';
        break;
    }
    this.errorMessage = '';
  }
}
