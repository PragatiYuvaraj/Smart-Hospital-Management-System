import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { User } from '../../core/models/user.model';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {
  user: User | null = null;
  serverProfile: User | null = null;
  isLoading = false;
  verifyMessage = '';

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.user = this.authService.getCurrentUser();
    this.verifyTokenWithBackend();
  }

  verifyTokenWithBackend(): void {
    this.isLoading = true;
    this.verifyMessage = '';

    this.authService.fetchProfile().subscribe({
      next: (profile) => {
        this.isLoading = false;
        if (profile) {
          this.serverProfile = profile;
          this.verifyMessage = 'JWT token validated successfully by backend GET /api/auth/me.';
        }
      },
      error: (err) => {
        this.isLoading = false;
        this.verifyMessage = 'Token validation failed. Session may have expired.';
      }
    });
  }

  onLogout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}
