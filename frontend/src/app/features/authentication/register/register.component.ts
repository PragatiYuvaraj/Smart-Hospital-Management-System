import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { getAuthErrorMessage } from '../../../core/auth/auth-error.util';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css']
})
export class RegisterComponent {
  name = '';
  email = '';
  password = '';
  confirmPassword = '';
  dateOfBirth = '';
  isLoading = false;
  errorMessage = '';

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  onSubmit(): void {
    if (!this.name || !this.email || !this.password || !this.dateOfBirth) {
      this.errorMessage = 'All fields are required.';
      return;
    }

    if (this.password.length < 6) {
      this.errorMessage = 'Password must be at least 6 characters.';
      return;
    }

    if (this.password !== this.confirmPassword) {
      this.errorMessage = 'Passwords do not match.';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    this.authService
      .register({
        name: this.name,
        email: this.email,
        password: this.password,
        dateOfBirth: this.dateOfBirth
      })
      .subscribe({
        next: (res) => {
          this.isLoading = false;
          if (res.success && res.data?.user) {
            void this.router.navigateByUrl(this.authService.getRoleHome(res.data.user.role));
          } else {
            this.errorMessage = res.message || 'Registration failed. Please try again.';
          }
        },
        error: (error: unknown) => {
          this.isLoading = false;
          this.errorMessage = getAuthErrorMessage(
            error,
            'Registration failed. Please try again.'
          );
        }
      });
  }
}
