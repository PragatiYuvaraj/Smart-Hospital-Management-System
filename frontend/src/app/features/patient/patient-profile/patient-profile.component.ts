import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { PatientService } from '../../../core/services/patient.service';
import { MedicalRecordService } from '../../../core/services/medical-record.service';
import { ReviewService } from '../../../core/services/review.service';
import { NotificationService } from '../../../core/services/notification.service';
import { MessagingPanelComponent } from '../../messaging/messaging-panel.component';
import { PatientProfile } from '../../../core/models/patient.model';
import { User } from '../../../core/models/user.model';
import {
  PatientMedicalRecord,
  PatientMedicalRecordListResponse
} from '../../../core/models/medical-record.model';
import { ReviewListResponse, ReviewSchedule } from '../../../core/models/review.model';
import {
  Notification,
  NotificationListResponse
} from '../../../core/models/notification.model';
import { getAuthErrorMessage } from '../../../core/auth/auth-error.util';
import { formatHospitalReviewDate } from '../../../core/utils/review-time.util';

@Component({
  selector: 'app-patient-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MessagingPanelComponent],
  templateUrl: './patient-profile.component.html',
  styleUrls: ['./patient-profile.component.css']
})
export class PatientProfileComponent implements OnInit {
  user: User | null = null;
  patient: PatientProfile | null = null;

  isLoading = true;
  isSaving = false;
  errorMessage = '';
  successMessage = '';

  // Form edit fields
  contactNumber = '';
  address = '';

  medicalRecords: PatientMedicalRecord[] = [];
  medicalRecordsPage = 1;
  medicalRecordsTotalPages = 1;
  isLoadingMedicalRecords = false;
  medicalRecordsErrorMessage = '';
  activeRecordId: string | null = null;
  selectedMedicalRecord: PatientMedicalRecord | null = null;
  isLoadingRecordDetail = false;
  recordDetailErrorMessage = '';
  isPatient = false;
  hospitalTimezone: string | null = null;
  isLoadingHospitalTimezone = false;
  hospitalTimezoneErrorMessage = '';
  reviews: ReviewSchedule[] = [];
  reviewsPage = 1;
  reviewsTotalPages = 1;
  isLoadingReviews = false;
  reviewsErrorMessage = '';
  notifications: Notification[] = [];
  notificationsPage = 1;
  notificationsTotalPages = 1;
  isLoadingNotifications = false;
  notificationsErrorMessage = '';
  notificationActionBusyId: string | null = null;
  notificationActionErrorMessage = '';
  notificationActionSuccessMessage = '';

  // Prescriptions state
  prescriptions: any[] = [];
  isLoadingPrescriptions = false;
  prescriptionsErrorMessage = '';

  private medicalRecordsRequestId = 0;
  private recordDetailRequestId = 0;
  private reviewsRequestId = 0;
  private notificationsRequestId = 0;

  constructor(
    private authService: AuthService,
    private patientService: PatientService,
    private medicalRecordService: MedicalRecordService,
    private reviewService: ReviewService,
    private notificationService: NotificationService
  ) {}

  ngOnInit(): void {
    this.user = this.authService.getCurrentUser();
    this.isPatient = this.user?.role === 'PATIENT';
    this.loadProfile();
    if (this.isPatient) {
      this.loadHospitalTimezone();
      this.loadNotifications();
      this.loadPrescriptions();
    }
  }

  get isNotificationActionBusy(): boolean {
    return this.notificationActionBusyId !== null;
  }

  loadProfile(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.patientService.getMyProfile().subscribe({
      next: (res) => {
        this.isLoading = false;
        if (res.success && res.data?.patient) {
          this.patient = res.data.patient;
          this.contactNumber = res.data.patient.contactNumber || '';
          this.address = res.data.patient.address || '';
          this.medicalRecordsPage = 1;
          this.loadMedicalRecords();
        } else {
          this.errorMessage = res.message || 'Failed to load patient profile.';
        }
      },
      error: (error: unknown) => {
        this.isLoading = false;
        this.errorMessage = getAuthErrorMessage(
          error,
          'Failed to load patient profile. Please try again.'
        );
      }
    });
  }

  loadPrescriptions(): void {
    if (!this.isPatient) return;
    this.isLoadingPrescriptions = true;
    this.prescriptionsErrorMessage = '';

    this.medicalRecordService.getMyPrescriptions().subscribe({
      next: (res) => {
        this.isLoadingPrescriptions = false;
        if (res.success && res.data?.prescriptions) {
          this.prescriptions = res.data.prescriptions;
        } else {
          this.prescriptionsErrorMessage = res.message || 'Failed to load prescriptions.';
        }
      },
      error: (err: unknown) => {
        this.isLoadingPrescriptions = false;
        this.prescriptionsErrorMessage = getAuthErrorMessage(
          err,
          'Unable to load your prescriptions. Please try again.'
        );
      }
    });
  }

  loadMedicalRecords(): void {
    const patientId = this.patient?._id;
    if (!patientId) return;

    const requestId = ++this.medicalRecordsRequestId;
    this.isLoadingMedicalRecords = true;
    this.medicalRecordsErrorMessage = '';

    this.medicalRecordService.getPatientMedicalRecords(patientId, {
      page: this.medicalRecordsPage,
      limit: 20
    }).subscribe({
      next: (res) => {
        if (requestId !== this.medicalRecordsRequestId || this.patient?._id !== patientId) return;
        this.isLoadingMedicalRecords = false;
        if (res.success && res.data) {
          this.applyMedicalRecordsResponse(res.data);
        } else {
          this.medicalRecordsErrorMessage = res.message || 'Failed to load your medical records.';
        }
      },
      error: (error: unknown) => {
        if (requestId !== this.medicalRecordsRequestId || this.patient?._id !== patientId) return;
        this.isLoadingMedicalRecords = false;
        this.medicalRecordsErrorMessage = getAuthErrorMessage(
          error,
          'Unable to load your medical records. Please try again.'
        );
      }
    });
  }

  loadHospitalTimezone(): void {
    if (!this.isPatient) return;
    this.isLoadingHospitalTimezone = true;
    this.hospitalTimezoneErrorMessage = '';
    this.reviewService.getHospitalTimezone().subscribe({
      next: (res) => {
        this.isLoadingHospitalTimezone = false;
        const timeZone = res.data?.hospitalTimezone;
        if (!res.success || !timeZone) {
          this.hospitalTimezoneErrorMessage =
            res.message || 'The configured hospital timezone is unavailable.';
          return;
        }

        try {
          new Intl.DateTimeFormat('en', { timeZone }).format(new Date());
        } catch (error) {
          if (!(error instanceof RangeError)) throw error;
          this.hospitalTimezoneErrorMessage =
            'The server returned an invalid hospital timezone. Review schedules are unavailable.';
          return;
        }

        this.hospitalTimezone = timeZone;
        this.loadUpcomingReviews();
      },
      error: (error: unknown) => {
        this.isLoadingHospitalTimezone = false;
        this.hospitalTimezoneErrorMessage = getAuthErrorMessage(
          error,
          'Could not load the configured hospital timezone. Review schedules are unavailable.'
        );
      }
    });
  }

  loadUpcomingReviews(page = this.reviewsPage): void {
    if (!this.isPatient || !this.hospitalTimezone) return;
    const requestId = ++this.reviewsRequestId;
    this.isLoadingReviews = true;
    this.reviewsErrorMessage = '';
    this.reviewService.getMyUpcomingReviews(page, 20).subscribe({
      next: (res) => {
        if (requestId !== this.reviewsRequestId) return;
        this.isLoadingReviews = false;
        if (res.success && res.data) {
          this.applyReviewsResponse(res);
        } else {
          this.reviewsErrorMessage = res.message || 'Failed to load your review schedule.';
        }
      },
      error: (error: unknown) => {
        if (requestId !== this.reviewsRequestId) return;
        this.isLoadingReviews = false;
        this.reviewsErrorMessage = getAuthErrorMessage(
          error,
          'Unable to load your review schedule. Please try again.'
        );
      }
    });
  }

  changeReviewsPage(page: number): void {
    if (
      page < 1 ||
      page > this.reviewsTotalPages ||
      page === this.reviewsPage ||
      this.isLoadingReviews
    ) return;
    this.reviewsPage = page;
    this.loadUpcomingReviews(page);
  }

  isReviewOverdue(review: ReviewSchedule): boolean {
    return new Date(review.reviewDate).getTime() < Date.now();
  }

  formatHospitalDate(value: string): string {
    return this.hospitalTimezone
      ? formatHospitalReviewDate(value, this.hospitalTimezone)
      : value;
  }

  loadNotifications(page = this.notificationsPage): void {
    if (!this.isPatient) return;
    const requestId = ++this.notificationsRequestId;
    this.isLoadingNotifications = true;
    this.notificationsErrorMessage = '';
    this.notificationService.getMyNotifications(page, 20).subscribe({
      next: (res) => {
        if (requestId !== this.notificationsRequestId) return;
        this.isLoadingNotifications = false;
        if (res.success && res.data) {
          this.applyNotificationsResponse(res);
        } else {
          this.notificationsErrorMessage = res.message || 'Failed to load your notifications.';
        }
      },
      error: (error: unknown) => {
        if (requestId !== this.notificationsRequestId) return;
        this.isLoadingNotifications = false;
        this.notificationsErrorMessage = getAuthErrorMessage(
          error,
          'Unable to load your notifications. Please try again.'
        );
      }
    });
  }

  changeNotificationsPage(page: number): void {
    if (
      page < 1 ||
      page > this.notificationsTotalPages ||
      page === this.notificationsPage ||
      this.isLoadingNotifications ||
      this.isNotificationActionBusy
    ) return;
    this.notificationsPage = page;
    this.loadNotifications(page);
  }

  markNotificationAsRead(notification: Notification): void {
    if (
      !this.isPatient ||
      notification.status !== 'SENT' ||
      this.isNotificationActionBusy
    ) return;

    this.notificationActionBusyId = notification._id;
    this.notificationActionErrorMessage = '';
    this.notificationActionSuccessMessage = '';
    this.notificationService.markAsRead(notification._id).subscribe({
      next: (res) => {
        this.notificationActionBusyId = null;
        if (!res.success || !res.data?.notification) {
          this.notificationActionErrorMessage =
            res.message || 'Could not mark this notification as read.';
          return;
        }
        this.applyReadNotificationResponse(res.data.notification);
        this.notificationActionSuccessMessage = 'Notification marked as read.';
      },
      error: (error: unknown) => {
        this.notificationActionBusyId = null;
        this.notificationActionErrorMessage = getAuthErrorMessage(
          error,
          'Could not mark this notification as read. Please try again.'
        );
      }
    });
  }

  changeMedicalRecordsPage(page: number): void {
    if (
      page < 1 ||
      page > this.medicalRecordsTotalPages ||
      page === this.medicalRecordsPage ||
      this.isLoadingMedicalRecords
    ) {
      return;
    }
    this.medicalRecordsPage = page;
    this.loadMedicalRecords();
  }

  openMedicalRecord(recordId: string): void {
    const requestId = ++this.recordDetailRequestId;
    this.activeRecordId = recordId;
    this.selectedMedicalRecord = null;
    this.isLoadingRecordDetail = true;
    this.recordDetailErrorMessage = '';

    this.medicalRecordService.getPatientMedicalRecord(recordId).subscribe({
      next: (res) => {
        if (requestId !== this.recordDetailRequestId || this.activeRecordId !== recordId) return;
        this.isLoadingRecordDetail = false;
        if (res.success && res.data) {
          this.selectedMedicalRecord = res.data;
        } else {
          this.recordDetailErrorMessage = res.message || 'Failed to load this medical record.';
        }
      },
      error: (error: unknown) => {
        if (requestId !== this.recordDetailRequestId || this.activeRecordId !== recordId) return;
        this.isLoadingRecordDetail = false;
        this.recordDetailErrorMessage = getAuthErrorMessage(
          error,
          'Unable to open this medical record. Please try again.'
        );
      }
    });
  }

  closeMedicalRecord(): void {
    this.recordDetailRequestId++;
    this.activeRecordId = null;
    this.selectedMedicalRecord = null;
    this.isLoadingRecordDetail = false;
    this.recordDetailErrorMessage = '';
  }

  onSubmit(): void {
    this.errorMessage = '';
    this.successMessage = '';

    // Validation
    const trimmedContact = this.contactNumber.trim();
    const trimmedAddress = this.address.trim();

    if (!trimmedContact && !trimmedAddress) {
      this.errorMessage = 'Please provide a contact number or address to update.';
      return;
    }

    if (trimmedContact.length > 30) {
      this.errorMessage = 'Contact number cannot exceed 30 characters.';
      return;
    }

    if (trimmedAddress.length > 500) {
      this.errorMessage = 'Address cannot exceed 500 characters.';
      return;
    }

    this.isSaving = true;

    const payload: { contactNumber?: string; address?: string } = {};
    if (trimmedContact !== (this.patient?.contactNumber || '')) {
      payload.contactNumber = trimmedContact;
    }
    if (trimmedAddress !== (this.patient?.address || '')) {
      payload.address = trimmedAddress;
    }

    if (Object.keys(payload).length === 0) {
      // Even if unchanged, send fields so backend can acknowledge or patient gets feedback
      payload.contactNumber = trimmedContact;
      payload.address = trimmedAddress;
    }

    this.patientService.updateMyProfile(payload).subscribe({
      next: (res) => {
        this.isSaving = false;
        if (res.success && res.data?.patient) {
          this.patient = res.data.patient;
          this.contactNumber = res.data.patient.contactNumber || '';
          this.address = res.data.patient.address || '';
          this.successMessage = 'Profile updated successfully.';
        } else {
          this.errorMessage = res.message || 'Update failed.';
        }
      },
      error: (error: unknown) => {
        this.isSaving = false;
        this.errorMessage = getAuthErrorMessage(
          error,
          'Failed to update profile. Please check the fields and try again.'
        );
      }
    });
  }

  onReset(): void {
    this.contactNumber = this.patient?.contactNumber || '';
    this.address = this.patient?.address || '';
    this.errorMessage = '';
    this.successMessage = '';
  }

  private applyMedicalRecordsResponse(data: PatientMedicalRecordListResponse): void {
    this.medicalRecords = data.records;
    this.medicalRecordsPage = data.page;
    this.medicalRecordsTotalPages = Math.max(1, data.totalPages);
  }

  private applyReviewsResponse(response: ReviewListResponse): void {
    this.reviews = response.data.reviews;
    this.reviewsPage = response.data.page;
    this.reviewsTotalPages = Math.max(1, response.data.totalPages);
  }

  private applyNotificationsResponse(response: NotificationListResponse): void {
    this.notifications = response.data.notifications;
    this.notificationsPage = response.data.page;
    this.notificationsTotalPages = Math.max(1, response.data.totalPages);
  }

  private applyReadNotificationResponse(updated: Notification): void {
    this.notifications = this.notifications.map((notification) =>
      notification._id === updated._id ? updated : notification
    );
  }
}
