import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { DoctorService } from '../../../core/services/doctor.service';
import { MedicalRecordService } from '../../../core/services/medical-record.service';
import { PharmacyService } from '../../../core/services/pharmacy.service';
import { ReviewService } from '../../../core/services/review.service';
import {
  AssignedPatientSummary,
  DoctorProfile,
  PatientSummary,
  VisiblePatientDetail
} from '../../../core/models/doctor.model';
import {
  CreateAmendmentRequest,
  CreateConsultationRequest,
  CreatePrescriptionRequest,
  CreatedPrescription,
  MedicalRecord,
  MedicalRecordApiResponse,
  PrescriptionItemRequest,
  UpdateConsultationRequest
} from '../../../core/models/medical-record.model';
import { Medicine } from '../../../core/models/pharmacy.model';
import {
  CreateReviewRequest,
  ReviewListResponse,
  ReviewResponse,
  ReviewSchedule
} from '../../../core/models/review.model';
import { getAuthErrorMessage } from '../../../core/auth/auth-error.util';
import {
  calculateHospitalReminderDate,
  formatHospitalDateTimeInput,
  formatHospitalReviewDate,
  hospitalDateTimeInputToIso
} from '../../../core/utils/review-time.util';
import { Observable } from 'rxjs';
import { MessagingPanelComponent } from '../../messaging/messaging-panel.component';

interface ConsultationFormValues {
  encounterDate: string;
  reason: string;
  symptoms: string;
  observations: string;
  diagnosis: string;
  notes: string;
  treatmentPlan: string;
}

@Component({
  selector: 'app-assigned-patients',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MessagingPanelComponent],
  templateUrl: './assigned-patients.component.html',
  styleUrls: ['./assigned-patients.component.css']
})
export class AssignedPatientsComponent implements OnInit {
  doctor: DoctorProfile | null = null;
  patients: AssignedPatientSummary[] = [];
  filteredPatients: AssignedPatientSummary[] = [];

  // Hospital-wide duty search
  isDutyDoctor = false;
  activeTab: 'assigned' | 'hospital' = 'assigned';
  hospitalPatients: PatientSummary[] = [];
  isLoadingHospital = false;
  hospitalSearchTerm = '';
  hospitalSearchMessage = '';

  isLoading = true;
  errorMessage = '';
  searchTerm = '';

  // Selected patient detail view
  selectedPatient: VisiblePatientDetail | null = null;
  isDoctor = false;
  isLoadingDetail = false;
  detailErrorMessage = '';
  medicalRecords: MedicalRecord[] = [];
  medicalRecordsPage = 1;
  medicalRecordsTotalPages = 1;
  isLoadingMedicalRecords = false;
  medicalRecordsErrorMessage = '';
  consultationForm: ConsultationFormValues = this.createEmptyConsultationForm();
  editingRecordId: string | null = null;
  isSavingConsultation = false;
  consultationErrorMessage = '';
  consultationSuccessMessage = '';
  recordActionBusyId: string | null = null;
  recordActionErrorMessage = '';
  recordActionSuccessMessage = '';
  amendmentRecordId: string | null = null;
  amendmentReason = '';
  amendmentChanges = '';
  isSavingAmendment = false;
  hospitalTimezone: string | null = null;
  isLoadingHospitalTimezone = false;
  hospitalTimezoneErrorMessage = '';
  minimumReviewDateTime = '';
  reviews: ReviewSchedule[] = [];
  reviewsPage = 1;
  reviewsTotalPages = 1;
  isLoadingReviews = false;
  isSavingReview = false;
  reviewActionBusyId: string | null = null;
  reviewErrorMessage = '';
  reviewSuccessMessage = '';
  reviewDateValidationMessage = '';
  newReviewDateTime = '';
  newReviewInstructions = '';
  editingReviewId: string | null = null;
  rescheduleDateTime = '';
  // Prescription Creation State
  prescriptionRecordId: string | null = null;
  prescriptionItems: PrescriptionItemRequest[] = [];
  availableMedicines: Medicine[] = [];
  isLoadingMedicines = false;
  isSavingPrescription = false;
  prescriptionErrorMessage = '';
  prescriptionSuccessMessage = '';

  private medicalRecordsRequestId = 0;
  private patientDetailRequestId = 0;
  private reviewsRequestId = 0;

  constructor(
    public authService: AuthService,
    private doctorService: DoctorService,
    private medicalRecordService: MedicalRecordService,
    private pharmacyService: PharmacyService,
    private reviewService: ReviewService
  ) {}

  ngOnInit(): void {
    this.isDoctor = this.authService.getUserRole() === 'DOCTOR';
    this.isDutyDoctor = this.authService.hasPermission('DUTY_DOCTOR');
    if (this.isDoctor) this.loadHospitalTimezone();
    this.loadDoctorAndPatients();
  }

  get isReviewActionBusy(): boolean {
    return this.isLoadingReviews || this.isSavingReview || this.reviewActionBusyId !== null;
  }

  get canMessageSelectedPatient(): boolean {
    const patientId = this.selectedPatient?._id;
    return this.isDoctor &&
      this.doctor?.status === 'ACTIVE' &&
      !!patientId &&
      this.patients.some(
        (patient) => patient._id === patientId && patient.status === 'ACTIVE'
      );
  }

  loadDoctorAndPatients(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.doctorService.getMyProfile().subscribe({
      next: (docRes) => {
        if (docRes.success && docRes.data?.doctor) {
          this.doctor = docRes.data.doctor;
          this.fetchAssignedPatients(docRes.data.doctor._id);
        } else {
          this.isLoading = false;
          this.errorMessage = 'Could not resolve doctor profile credentials.';
        }
      },
      error: (error: unknown) => {
        this.isLoading = false;
        this.errorMessage = getAuthErrorMessage(
          error,
          'Failed to load doctor profile. Please ensure an active doctor profile exists.'
        );
      }
    });
  }

  fetchAssignedPatients(doctorId: string): void {
    this.doctorService.getDoctorPatients(doctorId).subscribe({
      next: (res) => {
        this.isLoading = false;
        if (res.success && res.data?.patients) {
          this.patients = res.data.patients;
          this.applyFilter();
        } else {
          this.errorMessage = res.message || 'Failed to retrieve assigned patients.';
        }
      },
      error: (error: unknown) => {
        this.isLoading = false;
        this.errorMessage = getAuthErrorMessage(
          error,
          'Failed to load assigned patients. Please try again.'
        );
      }
    });
  }

  onSearchChange(): void {
    this.applyFilter();
  }

  applyFilter(): void {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) {
      this.filteredPatients = [...this.patients];
    } else {
      this.filteredPatients = this.patients.filter(
        (p) =>
          p.name.toLowerCase().includes(term) ||
          p.patientNumber.toLowerCase().includes(term)
      );
    }
  }

  switchTab(tab: 'assigned' | 'hospital'): void {
    this.activeTab = tab;
    if (tab === 'hospital' && this.hospitalPatients.length === 0) {
      this.fetchHospitalPatients();
    }
  }

  fetchHospitalPatients(): void {
    this.isLoadingHospital = true;
    this.hospitalSearchMessage = '';

    this.doctorService.getHospitalPatients(this.hospitalSearchTerm).subscribe({
      next: (res) => {
        this.isLoadingHospital = false;
        if (res.success && res.data?.patients) {
          this.hospitalPatients = res.data.patients;
        } else {
          this.hospitalSearchMessage = 'Failed to load hospital patients.';
        }
      },
      error: (error: unknown) => {
        this.isLoadingHospital = false;
        this.hospitalSearchMessage = getAuthErrorMessage(
          error,
          'Failed to search hospital patients. Please verify cross-coverage authorization.'
        );
      }
    });
  }

  onHospitalSearch(): void {
    this.fetchHospitalPatients();
  }

  viewPatientDetail(patientId: string): void {
    this.resetPatientClinicalState();
    this.selectedPatient = null;
    const requestId = ++this.patientDetailRequestId;
    this.isLoadingDetail = true;
    this.detailErrorMessage = '';

    this.doctorService.getPatientDetail(patientId).subscribe({
      next: (res) => {
        if (requestId !== this.patientDetailRequestId) return;
        this.isLoadingDetail = false;
        if (res.success && res.data?.patient) {
          this.selectedPatient = res.data.patient;
          this.medicalRecordsPage = 1;
          this.loadMedicalRecords();
          this.loadReviewSchedules();
        } else {
          this.detailErrorMessage = res.message || 'Could not retrieve patient profile.';
        }
      },
      error: (error: unknown) => {
        if (requestId !== this.patientDetailRequestId) return;
        this.isLoadingDetail = false;
        this.detailErrorMessage = getAuthErrorMessage(
          error,
          'You are not authorized to view this patient profile.'
        );
      }
    });
  }

  loadHospitalTimezone(): void {
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
            'The server returned an invalid hospital timezone. Review scheduling is unavailable.';
          return;
        }

        this.hospitalTimezone = timeZone;
        this.minimumReviewDateTime = formatHospitalDateTimeInput(new Date(), timeZone);
        if (this.selectedPatient) this.loadReviewSchedules();
      },
      error: (error: unknown) => {
        this.isLoadingHospitalTimezone = false;
        this.hospitalTimezoneErrorMessage = getAuthErrorMessage(
          error,
          'Could not load the configured hospital timezone. Review scheduling is unavailable.'
        );
      }
    });
  }

  loadReviewSchedules(page = this.reviewsPage): void {
    const patientId = this.selectedPatient?._id;
    if (!this.isDoctor || !patientId || !this.hospitalTimezone) return;

    const requestId = ++this.reviewsRequestId;
    this.isLoadingReviews = true;
    this.reviewErrorMessage = '';
    this.reviewService.getUpcomingReviews(patientId, page).subscribe({
      next: (res) => {
        if (
          this.selectedPatient?._id !== patientId ||
          requestId !== this.reviewsRequestId
        ) return;
        this.isLoadingReviews = false;
        if (!res.success || !res.data) {
          this.reviewErrorMessage = res.message || 'Failed to load scheduled reviews.';
          return;
        }
        this.setReviewList(res);
      },
      error: (error: unknown) => {
        if (
          this.selectedPatient?._id !== patientId ||
          requestId !== this.reviewsRequestId
        ) return;
        this.isLoadingReviews = false;
        this.reviewErrorMessage = getAuthErrorMessage(
          error,
          'Failed to load scheduled reviews. Please try again.'
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
    this.loadReviewSchedules(page);
  }

  scheduleReview(form: NgForm): void {
    if (!this.isDoctor || this.isReviewActionBusy || !this.selectedPatient) return;
    if (form.invalid) {
      form.control.markAllAsTouched();
      return;
    }

    const reviewDate = this.reviewDateFromInput(this.newReviewDateTime);
    if (!reviewDate) return;

    const payload: CreateReviewRequest = {
      patientId: this.selectedPatient._id,
      reviewDate
    };
    const instructions = this.newReviewInstructions.trim();
    if (instructions) payload.instructions = instructions;

    const patientId = this.selectedPatient._id;
    this.isSavingReview = true;
    this.reviewErrorMessage = '';
    this.reviewSuccessMessage = '';
    this.reviewService.createReview(payload).subscribe({
      next: (res) => {
        if (this.selectedPatient?._id !== patientId) return;
        this.isSavingReview = false;
        if (!res.success) {
          this.reviewErrorMessage = res.message || 'Could not schedule the review.';
          return;
        }
        this.newReviewDateTime = '';
        this.newReviewInstructions = '';
        form.resetForm({ reviewDateTime: '', instructions: '' });
        this.reviewSuccessMessage = 'Review scheduled successfully.';
        this.reviewsPage = 1;
        this.loadReviewSchedules();
      },
      error: (error: unknown) => {
        if (this.selectedPatient?._id !== patientId) return;
        this.isSavingReview = false;
        this.reviewErrorMessage = getAuthErrorMessage(
          error,
          'Could not schedule the review. Please try again.'
        );
      }
    });
  }

  startRescheduling(review: ReviewSchedule): void {
    if (!this.isDoctor || this.isReviewActionBusy || !this.hospitalTimezone) return;
    this.editingReviewId = review._id;
    this.rescheduleDateTime = formatHospitalDateTimeInput(
      new Date(review.reviewDate),
      this.hospitalTimezone
    );
    this.reviewDateValidationMessage = '';
    this.reviewErrorMessage = '';
    this.reviewSuccessMessage = '';
  }

  saveReschedule(review: ReviewSchedule, form: NgForm): void {
    if (!this.isDoctor || this.isReviewActionBusy || form.invalid) {
      form.control.markAllAsTouched();
      return;
    }
    const reviewDate = this.reviewDateFromInput(this.rescheduleDateTime);
    if (!reviewDate) return;

    this.performReviewAction(
      review,
      () => this.reviewService.rescheduleReview(review._id, { reviewDate }),
      'Review rescheduled successfully.'
    );
  }

  cancelScheduledReview(review: ReviewSchedule): void {
    if (
      !this.isDoctor ||
      this.isReviewActionBusy ||
      !window.confirm(`Cancel the review scheduled for ${this.formatReviewDate(review.reviewDate)}?`)
    ) return;
    this.performReviewAction(
      review,
      () => this.reviewService.cancelReview(review._id),
      'Review cancelled successfully.'
    );
  }

  completeScheduledReview(review: ReviewSchedule): void {
    if (
      !this.isDoctor ||
      this.isReviewActionBusy ||
      !window.confirm(`Mark the review scheduled for ${this.formatReviewDate(review.reviewDate)} as completed?`)
    ) return;
    this.performReviewAction(
      review,
      () => this.reviewService.completeReview(review._id),
      'Review marked as completed.'
    );
  }

  formatReviewDate(value: string): string {
    return this.hospitalTimezone
      ? formatHospitalReviewDate(value, this.hospitalTimezone)
      : value;
  }

  isReviewOverdue(review: ReviewSchedule): boolean {
    return new Date(review.reviewDate).getTime() < Date.now();
  }

  loadMedicalRecords(): void {
    const patientId = this.selectedPatient?._id;
    if (!patientId) return;

    const requestId = ++this.medicalRecordsRequestId;
    this.isLoadingMedicalRecords = true;
    this.medicalRecordsErrorMessage = '';
    this.medicalRecordService.getPatientMedicalRecordsForDoctor(patientId, {
      page: this.medicalRecordsPage,
      limit: 20
    }).subscribe({
      next: (res) => {
        if (this.selectedPatient?._id !== patientId || requestId !== this.medicalRecordsRequestId) return;
        this.isLoadingMedicalRecords = false;
        if (res.success && res.data) {
          this.medicalRecords = res.data.records;
          this.medicalRecordsPage = res.data.page;
          this.medicalRecordsTotalPages = Math.max(1, res.data.totalPages);
        } else {
          this.medicalRecordsErrorMessage = res.message || 'Failed to load medical history.';
        }
      },
      error: (error: unknown) => {
        if (this.selectedPatient?._id !== patientId || requestId !== this.medicalRecordsRequestId) return;
        this.isLoadingMedicalRecords = false;
        this.medicalRecordsErrorMessage = getAuthErrorMessage(
          error,
          'You are not authorized to view this patient’s medical history.'
        );
      }
    });
  }

  changeMedicalRecordsPage(page: number): void {
    if (page < 1 || page > this.medicalRecordsTotalPages || page === this.medicalRecordsPage) {
      return;
    }
    this.medicalRecordsPage = page;
    this.loadMedicalRecords();
  }

  isOwnDraft(record: MedicalRecord): boolean {
    return record.status === 'DRAFT' &&
      !!this.doctor &&
      record.doctorId === this.doctor._id;
  }

  saveConsultation(form: NgForm): void {
    if (form.invalid || this.isSavingConsultation || !this.selectedPatient) {
      form.control.markAllAsTouched();
      return;
    }
    if (
      !this.consultationForm.encounterDate ||
      !this.consultationForm.reason.trim() ||
      !this.consultationForm.symptoms.trim() ||
      !this.consultationForm.diagnosis.trim() ||
      !this.consultationForm.treatmentPlan.trim()
    ) {
      form.control.markAllAsTouched();
      this.consultationErrorMessage = 'Complete each required field with a valid value.';
      return;
    }

    const patientId = this.selectedPatient._id;
    this.isSavingConsultation = true;
    this.consultationErrorMessage = '';
    this.consultationSuccessMessage = '';

    if (this.editingRecordId) {
      const payload: UpdateConsultationRequest = {
        reason: this.consultationForm.reason.trim(),
        symptoms: this.consultationForm.symptoms.trim(),
        observations: this.consultationForm.observations.trim(),
        diagnosis: this.consultationForm.diagnosis.trim(),
        notes: this.consultationForm.notes.trim(),
        treatmentPlan: this.consultationForm.treatmentPlan.trim()
      };
      this.medicalRecordService.updateDraftConsultation(this.editingRecordId, payload).subscribe({
        next: (res) => this.finishConsultationSave(res, 'Draft consultation updated.', patientId),
        error: (error: unknown) => this.handleConsultationSaveError(error, patientId)
      });
      return;
    }

    const payload: CreateConsultationRequest = {
      patientId,
      encounterDate: this.consultationForm.encounterDate,
      reason: this.consultationForm.reason.trim(),
      symptoms: this.consultationForm.symptoms.trim(),
      observations: this.consultationForm.observations.trim(),
      diagnosis: this.consultationForm.diagnosis.trim(),
      notes: this.consultationForm.notes.trim(),
      treatmentPlan: this.consultationForm.treatmentPlan.trim(),
      status: 'DRAFT'
    };
    this.medicalRecordService.createConsultation(payload).subscribe({
      next: (res) => this.finishConsultationSave(res, 'Consultation saved as a draft.', patientId, true),
      error: (error: unknown) => this.handleConsultationSaveError(error, patientId)
    });
  }

  editDraft(record: MedicalRecord): void {
    if (!this.isOwnDraft(record)) return;

    this.editingRecordId = record._id;
    this.consultationForm = {
      encounterDate: record.encounterDate.slice(0, 10),
      reason: record.reason,
      symptoms: record.symptoms,
      observations: record.observations || '',
      diagnosis: record.diagnosis,
      notes: record.notes || '',
      treatmentPlan: record.treatmentPlan
    };
    this.consultationErrorMessage = '';
    this.consultationSuccessMessage = '';
  }

  cancelDraftEdit(): void {
    this.editingRecordId = null;
    this.consultationForm = this.createEmptyConsultationForm();
    this.consultationErrorMessage = '';
  }

  finalizeDraft(record: MedicalRecord): void {
    if (!this.isOwnDraft(record) || this.recordActionBusyId) return;
    this.performRecordAction(
      record._id,
      () => this.medicalRecordService.finalizeConsultation(record._id),
      'Consultation finalized.'
    );
  }

  togglePatientRelease(record: MedicalRecord): void {
    if (record.status !== 'FINALIZED' || this.recordActionBusyId) return;
    const isReleased = !record.isReleased;
    this.performRecordAction(
      record._id,
      () => this.medicalRecordService.setPatientRelease(record._id, { isReleased }),
      isReleased ? 'Consultation released to the patient.' : 'Patient release retracted.'
    );
  }

  togglePrescriptionForm(record: MedicalRecord): void {
    if (this.prescriptionRecordId === record._id) {
      this.prescriptionRecordId = null;
      this.prescriptionItems = [];
      this.prescriptionErrorMessage = '';
      this.prescriptionSuccessMessage = '';
      return;
    }

    this.prescriptionRecordId = record._id;
    this.prescriptionItems = [this.createEmptyPrescriptionItem()];
    this.prescriptionErrorMessage = '';
    this.prescriptionSuccessMessage = '';
    this.recordActionErrorMessage = '';
    this.recordActionSuccessMessage = '';

    if (this.availableMedicines.length === 0) {
      this.loadMedicinesCatalogue();
    }
  }

  createEmptyPrescriptionItem(): PrescriptionItemRequest {
    return {
      medicineId: '',
      dosage: '',
      frequency: 'Once daily',
      duration: '7 days',
      quantity: 1,
      route: 'Oral',
      instructions: ''
    };
  }

  addPrescriptionItem(): void {
    this.prescriptionItems.push(this.createEmptyPrescriptionItem());
  }

  removePrescriptionItem(index: number): void {
    if (this.prescriptionItems.length > 1) {
      this.prescriptionItems.splice(index, 1);
    }
  }

  loadMedicinesCatalogue(): void {
    this.isLoadingMedicines = true;
    this.pharmacyService.getMedicines({ limit: 100 }).subscribe({
      next: (res) => {
        this.isLoadingMedicines = false;
        if (res.success && res.data?.medicines) {
          this.availableMedicines = res.data.medicines.filter((m) => m.active);
        }
      },
      error: (err) => {
        this.isLoadingMedicines = false;
        this.prescriptionErrorMessage = getAuthErrorMessage(
          err,
          'Unable to load medicine catalogue. Please try again.'
        );
      }
    });
  }

  submitPrescription(record: MedicalRecord, form: NgForm): void {
    if (this.isSavingPrescription || !this.selectedPatient) return;
    this.prescriptionErrorMessage = '';
    this.prescriptionSuccessMessage = '';

    // Frontend validation
    if (this.prescriptionItems.length === 0) {
      this.prescriptionErrorMessage = 'At least one medicine item is required.';
      return;
    }

    const selectedIds = new Set<string>();
    for (let i = 0; i < this.prescriptionItems.length; i++) {
      const item = this.prescriptionItems[i];
      if (!item.medicineId) {
        this.prescriptionErrorMessage = `Please select a medicine for item #${i + 1}.`;
        return;
      }
      if (selectedIds.has(item.medicineId)) {
        this.prescriptionErrorMessage = `Duplicate medicine selected in item #${i + 1}. Each medicine can only be prescribed once per prescription.`;
        return;
      }
      selectedIds.add(item.medicineId);

      if (!item.dosage || !item.dosage.trim()) {
        this.prescriptionErrorMessage = `Dosage is required for item #${i + 1}.`;
        return;
      }
      if (!item.frequency || !item.frequency.trim()) {
        this.prescriptionErrorMessage = `Frequency is required for item #${i + 1}.`;
        return;
      }
      if (!item.duration || !item.duration.trim()) {
        this.prescriptionErrorMessage = `Duration is required for item #${i + 1}.`;
        return;
      }
      if (!item.quantity || item.quantity < 1) {
        this.prescriptionErrorMessage = `Quantity must be a positive number for item #${i + 1}.`;
        return;
      }
    }

    const payload: CreatePrescriptionRequest = {
      medicalRecordId: record._id,
      patientId: this.selectedPatient._id,
      items: this.prescriptionItems.map((item) => ({
        medicineId: item.medicineId,
        dosage: item.dosage.trim(),
        route: item.route?.trim() || undefined,
        frequency: item.frequency.trim(),
        duration: item.duration.trim(),
        quantity: Math.floor(Number(item.quantity)),
        instructions: item.instructions?.trim() || undefined
      }))
    };

    this.isSavingPrescription = true;
    this.medicalRecordService.createPrescription(payload).subscribe({
      next: (res) => {
        this.isSavingPrescription = false;
        if (res.success) {
          this.prescriptionSuccessMessage = 'Prescription created and forwarded to the pharmacy queue.';
          this.prescriptionRecordId = null;
          this.prescriptionItems = [];
          this.recordActionSuccessMessage = 'Prescription created successfully.';
          this.loadMedicalRecords();
        } else {
          this.prescriptionErrorMessage = res.message || 'Could not create prescription.';
        }
      },
      error: (err: unknown) => {
        this.isSavingPrescription = false;
        this.prescriptionErrorMessage = getAuthErrorMessage(
          err,
          'Failed to create prescription. Please check details and try again.'
        );
      }
    });
  }

  toggleAmendmentForm(record: MedicalRecord): void {
    this.amendmentRecordId = this.amendmentRecordId === record._id ? null : record._id;
    this.amendmentReason = '';
    this.amendmentChanges = '';
    this.recordActionErrorMessage = '';
    this.recordActionSuccessMessage = '';
  }

  submitAmendment(record: MedicalRecord, form: NgForm): void {
    const reason = this.amendmentReason.trim();
    const changes = this.amendmentChanges.trim();
    if (form.invalid || reason.length < 5 || reason.length > 500 || !changes || this.isSavingAmendment) {
      form.control.markAllAsTouched();
      return;
    }

    const payload: CreateAmendmentRequest = { reason, changes };
    const patientId = this.selectedPatient?._id;
    this.isSavingAmendment = true;
    this.recordActionErrorMessage = '';
    this.recordActionSuccessMessage = '';
    this.medicalRecordService.addAmendment(record._id, payload).subscribe({
      next: (res) => {
        if (!patientId || this.selectedPatient?._id !== patientId) return;
        this.isSavingAmendment = false;
        if (res.success) {
          this.amendmentRecordId = null;
          this.amendmentReason = '';
          this.amendmentChanges = '';
          this.recordActionSuccessMessage = 'Amendment added to the consultation.';
          this.loadMedicalRecords();
        } else {
          this.recordActionErrorMessage = res.message || 'Could not add amendment.';
        }
      },
      error: (error: unknown) => {
        if (!patientId || this.selectedPatient?._id !== patientId) return;
        this.isSavingAmendment = false;
        this.recordActionErrorMessage = getAuthErrorMessage(
          error,
          'Could not add the amendment. Please try again.'
        );
      }
    });
  }

  closePatientDetail(): void {
    this.selectedPatient = null;
    this.detailErrorMessage = '';
    this.isLoadingDetail = false;
    this.patientDetailRequestId++;
    this.resetPatientClinicalState();
  }

  private resetPatientClinicalState(): void {
    this.medicalRecordsRequestId++;
    this.reviewsRequestId++;
    this.medicalRecords = [];
    this.reviews = [];
    this.reviewsPage = 1;
    this.reviewsTotalPages = 1;
    this.isLoadingReviews = false;
    this.isSavingReview = false;
    this.reviewActionBusyId = null;
    this.reviewErrorMessage = '';
    this.reviewSuccessMessage = '';
    this.reviewDateValidationMessage = '';
    this.newReviewDateTime = '';
    this.newReviewInstructions = '';
    this.editingReviewId = null;
    this.rescheduleDateTime = '';
    this.medicalRecordsErrorMessage = '';
    this.medicalRecordsPage = 1;
    this.medicalRecordsTotalPages = 1;
    this.isLoadingMedicalRecords = false;
    this.cancelDraftEdit();
    this.amendmentRecordId = null;
    this.amendmentReason = '';
    this.amendmentChanges = '';
    this.isSavingAmendment = false;
    this.isSavingConsultation = false;
    this.recordActionBusyId = null;
    this.recordActionErrorMessage = '';
    this.recordActionSuccessMessage = '';
    this.consultationSuccessMessage = '';
  }

  private setReviewList(response: ReviewListResponse): void {
    this.reviews = response.data.reviews;
    this.reviewsPage = response.data.page;
    this.reviewsTotalPages = Math.max(1, response.data.totalPages);
  }

  private reviewDateFromInput(value: string): string | null {
    this.reviewDateValidationMessage = '';
    if (!this.hospitalTimezone) {
      this.reviewDateValidationMessage = 'The hospital timezone is not available.';
      return null;
    }

    const reviewDate = hospitalDateTimeInputToIso(value, this.hospitalTimezone);
    if (!reviewDate) {
      this.reviewDateValidationMessage =
        'Choose a valid hospital-local time. Times skipped during a daylight-saving change cannot be scheduled.';
      return null;
    }
    if (new Date(reviewDate).getTime() <= Date.now()) {
      this.reviewDateValidationMessage = 'Choose a future review date and time.';
      return null;
    }
    const reminderDate = calculateHospitalReminderDate(reviewDate, this.hospitalTimezone);
    if (!reminderDate || reminderDate.getTime() <= Date.now()) {
      this.reviewDateValidationMessage =
        'Schedule far enough ahead for the two-calendar-day reminder to remain in the future.';
      return null;
    }
    return reviewDate;
  }

  private performReviewAction(
    review: ReviewSchedule,
    action: () => Observable<ReviewResponse>,
    successMessage: string
  ): void {
    const patientId = this.selectedPatient?._id;
    if (!patientId) return;

    this.reviewActionBusyId = review._id;
    this.reviewErrorMessage = '';
    this.reviewSuccessMessage = '';
    action().subscribe({
      next: (res) => {
        if (this.selectedPatient?._id !== patientId) return;
        this.reviewActionBusyId = null;
        if (!res.success) {
          this.reviewErrorMessage = res.message || 'The review action could not be completed.';
          return;
        }
        this.editingReviewId = null;
        this.reviewSuccessMessage = successMessage;
        this.reviewsPage = 1;
        this.loadReviewSchedules();
      },
      error: (error: unknown) => {
        if (this.selectedPatient?._id !== patientId) return;
        this.reviewActionBusyId = null;
        this.reviewErrorMessage = getAuthErrorMessage(
          error,
          'The review action could not be completed. Please try again.'
        );
      }
    });
  }

  private createEmptyConsultationForm(): ConsultationFormValues {
    return {
      encounterDate: this.getLocalDate(),
      reason: '',
      symptoms: '',
      observations: '',
      diagnosis: '',
      notes: '',
      treatmentPlan: ''
    };
  }

  private getLocalDate(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  }

  private finishConsultationSave(
    response: MedicalRecordApiResponse<MedicalRecord>,
    successMessage: string,
    patientId: string,
    created = false
  ): void {
    if (this.selectedPatient?._id !== patientId) return;
    this.isSavingConsultation = false;
    if (!response.success) {
      this.consultationErrorMessage = response.message || 'Could not save consultation.';
      return;
    }

    this.consultationSuccessMessage = successMessage;
    this.editingRecordId = null;
    this.consultationForm = this.createEmptyConsultationForm();
    if (created) this.medicalRecordsPage = 1;
    this.loadMedicalRecords();
  }

  private handleConsultationSaveError(error: unknown, patientId: string): void {
    if (this.selectedPatient?._id !== patientId) return;
    this.isSavingConsultation = false;
    this.consultationErrorMessage = getAuthErrorMessage(
      error,
      'Could not save the consultation. Please try again.'
    );
  }

  private performRecordAction(
    recordId: string,
    action: () => Observable<MedicalRecordApiResponse<MedicalRecord>>,
    successMessage: string
  ): void {
    const patientId = this.selectedPatient?._id;
    if (!patientId) return;

    this.recordActionBusyId = recordId;
    this.recordActionErrorMessage = '';
    this.recordActionSuccessMessage = '';
    action().subscribe({
      next: (res) => {
        if (this.selectedPatient?._id !== patientId) return;
        this.recordActionBusyId = null;
        if (res.success) {
          this.recordActionSuccessMessage = successMessage;
          this.loadMedicalRecords();
        } else {
          this.recordActionErrorMessage = res.message || 'The consultation action could not be completed.';
        }
      },
      error: (error: unknown) => {
        if (this.selectedPatient?._id !== patientId) return;
        this.recordActionBusyId = null;
        this.recordActionErrorMessage = getAuthErrorMessage(
          error,
          'The consultation action could not be completed. Please try again.'
        );
      }
    });
  }
}
