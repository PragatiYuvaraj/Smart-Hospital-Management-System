import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { PatientService } from '../../core/services/patient.service';
import { DoctorService } from '../../core/services/doctor.service';
import { ReviewService } from '../../core/services/review.service';
import { NotificationService } from '../../core/services/notification.service';
import { MessagingService } from '../../core/services/messaging.service';
import { User } from '../../core/models/user.model';
import { PatientProfile } from '../../core/models/patient.model';
import { DoctorProfile } from '../../core/models/doctor.model';
import { ReviewSchedule } from '../../core/models/review.model';
import { getAuthErrorMessage } from '../../core/auth/auth-error.util';
import { formatHospitalReviewDate } from '../../core/utils/review-time.util';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {
  user: User | null = null;

  // --- Patient dashboard state ---
  patientProfile: PatientProfile | null = null;
  isLoadingPatient = false;
  patientErrorMessage = '';

  treatingDoctorName: string | null = null;
  treatingDoctorSpecialization: string | null = null;
  isLoadingAssignment = false;

  // --- Doctor dashboard state ---
  doctorProfile: DoctorProfile | null = null;
  isLoadingDoctor = false;
  doctorErrorMessage = '';

  assignedPatientCount: number | null = null;
  isLoadingPatients = false;

  // --- Shared state ---
  upcomingReviews: ReviewSchedule[] = [];
  upcomingReviewCount = 0;
  isLoadingReviews = false;

  unreadNotificationCount = 0;
  totalNotificationCount = 0;
  isLoadingNotifications = false;

  conversationCount = 0;
  isLoadingConversations = false;

  hospitalTimezone: string | null = null;

  dashboardError = '';

  constructor(
    public authService: AuthService,
    private router: Router,
    private patientService: PatientService,
    private doctorService: DoctorService,
    private reviewService: ReviewService,
    private notificationService: NotificationService,
    private messagingService: MessagingService
  ) {}

  ngOnInit(): void {
    this.user = this.authService.getCurrentUser();
    if (!this.user) return;

    if (this.user.role === 'PHARMACY') {
      this.router.navigate(['/pharmacy-dashboard']);
      return;
    }

    // Load hospital timezone for review formatting
    this.reviewService.getHospitalTimezone().subscribe({
      next: (res) => {
        if (res.success && res.data?.hospitalTimezone) {
          this.hospitalTimezone = res.data.hospitalTimezone;
        }
      },
      error: () => {}
    });

    // Load notifications for all roles
    this.loadNotifications();

    if (this.user.role === 'PATIENT') {
      this.loadPatientDashboard();
    } else if (this.user.role === 'DOCTOR') {
      this.loadDoctorDashboard();
    }
  }

  get isPatient(): boolean {
    return this.user?.role === 'PATIENT';
  }

  get isDoctor(): boolean {
    return this.user?.role === 'DOCTOR';
  }

  get isLoading(): boolean {
    return this.isLoadingPatient || this.isLoadingDoctor ||
      this.isLoadingReviews || this.isLoadingNotifications ||
      this.isLoadingPatients || this.isLoadingConversations ||
      this.isLoadingAssignment;
  }

  formatReviewDate(date: string): string {
    if (this.hospitalTimezone) {
      return formatHospitalReviewDate(date, this.hospitalTimezone);
    }
    return new Date(date).toLocaleDateString('en', {
      dateStyle: 'medium'
    });
  }

  onLogout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  // --- Patient loading ---

  private loadPatientDashboard(): void {
    this.isLoadingPatient = true;
    this.patientErrorMessage = '';

    this.patientService.getMyProfile().subscribe({
      next: (res) => {
        this.isLoadingPatient = false;
        if (res.success && res.data?.patient) {
          this.patientProfile = res.data.patient;
          this.loadPatientAssignment(res.data.patient._id);
          this.loadUpcomingReviews();
        } else {
          this.patientErrorMessage = res.message || 'Failed to load patient profile.';
        }
      },
      error: (err: unknown) => {
        this.isLoadingPatient = false;
        this.patientErrorMessage = getAuthErrorMessage(
          err,
          'Unable to load your profile. Please try again.'
        );
      }
    });

    this.loadConversations();
  }

  private loadPatientAssignment(patientId: string): void {
    this.isLoadingAssignment = true;
    this.patientService.getPatientAssignment(patientId).subscribe({
      next: (res) => {
        this.isLoadingAssignment = false;
        if (res.success && res.data?.assignment) {
          const doctorId = res.data.assignment.doctorId;
          this.loadDoctorName(doctorId);
        }
      },
      error: () => {
        this.isLoadingAssignment = false;
      }
    });
  }

  private loadDoctorName(doctorId: string): void {
    this.doctorService.getDoctorById(doctorId).subscribe({
      next: (res) => {
        if (res.success && res.data?.doctor) {
          this.treatingDoctorName = res.data.doctor.name;
          this.treatingDoctorSpecialization = res.data.doctor.specialization;
        }
      },
      error: () => {}
    });
  }

  // --- Doctor loading ---

  private loadDoctorDashboard(): void {
    this.isLoadingDoctor = true;
    this.doctorErrorMessage = '';

    this.doctorService.getMyProfile().subscribe({
      next: (res) => {
        this.isLoadingDoctor = false;
        if (res.success && res.data?.doctor) {
          this.doctorProfile = res.data.doctor;
          this.loadAssignedPatients(res.data.doctor._id);
          this.loadUpcomingReviews();
        } else {
          this.doctorErrorMessage = res.message || 'Failed to load doctor profile.';
        }
      },
      error: (err: unknown) => {
        this.isLoadingDoctor = false;
        this.doctorErrorMessage = getAuthErrorMessage(
          err,
          'Unable to load your profile. Please try again.'
        );
      }
    });

    this.loadConversations();
  }

  private loadAssignedPatients(doctorId: string): void {
    this.isLoadingPatients = true;
    this.doctorService.getDoctorPatients(doctorId).subscribe({
      next: (res) => {
        this.isLoadingPatients = false;
        if (res.success && res.data?.patients) {
          this.assignedPatientCount = res.data.patients.length;
        }
      },
      error: () => {
        this.isLoadingPatients = false;
      }
    });
  }

  // --- Shared loading ---

  private loadUpcomingReviews(): void {
    this.isLoadingReviews = true;
    this.reviewService.getMyUpcomingReviews(1, 5).subscribe({
      next: (res) => {
        this.isLoadingReviews = false;
        if (res.success && res.data) {
          this.upcomingReviews = res.data.reviews;
          this.upcomingReviewCount = res.data.total;
        }
      },
      error: () => {
        this.isLoadingReviews = false;
      }
    });
  }

  private loadNotifications(): void {
    this.isLoadingNotifications = true;
    this.notificationService.getMyNotifications(1, 100).subscribe({
      next: (res) => {
        this.isLoadingNotifications = false;
        if (res.success && res.data) {
          this.totalNotificationCount = res.data.total;
          this.unreadNotificationCount = res.data.notifications
            .filter(n => n.status === 'SENT').length;
        }
      },
      error: () => {
        this.isLoadingNotifications = false;
      }
    });
  }

  private loadConversations(): void {
    this.isLoadingConversations = true;
    this.messagingService.getConversations(1, 50).subscribe({
      next: (res) => {
        this.isLoadingConversations = false;
        if (res.success && res.data) {
          this.conversationCount = res.data.total;
        }
      },
      error: () => {
        this.isLoadingConversations = false;
      }
    });
  }
}
