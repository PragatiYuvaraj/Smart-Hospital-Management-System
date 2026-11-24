import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { DoctorService } from '../../../core/services/doctor.service';
import { DoctorProfile } from '../../../core/models/doctor.model';
import { User } from '../../../core/models/user.model';
import { getAuthErrorMessage } from '../../../core/auth/auth-error.util';

@Component({
  selector: 'app-doctor-profile',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './doctor-profile.component.html',
  styleUrls: ['./doctor-profile.component.css']
})
export class DoctorProfileComponent implements OnInit {
  user: User | null = null;
  doctor: DoctorProfile | null = null;

  isLoading = true;
  errorMessage = '';

  constructor(
    public authService: AuthService,
    private doctorService: DoctorService
  ) {}

  ngOnInit(): void {
    this.user = this.authService.getCurrentUser();
    this.loadProfile();
  }

  loadProfile(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.doctorService.getMyProfile().subscribe({
      next: (res) => {
        this.isLoading = false;
        if (res.success && res.data?.doctor) {
          this.doctor = res.data.doctor;
        } else {
          this.errorMessage = res.message || 'Failed to load doctor profile.';
        }
      },
      error: (error: unknown) => {
        this.isLoading = false;
        this.errorMessage = getAuthErrorMessage(
          error,
          'Failed to load doctor profile. Please verify your doctor account or contact hospital administration.'
        );
      }
    });
  }
}
