import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { AssignmentService } from '../../core/services/assignment.service';
import { ToastService } from '../../core/services/toast.service';
import {
  DoctorAssignmentItem,
  AssignmentDoctorSummary
} from '../../core/models/assignment.model';
import { PatientSummary } from '../../core/models/doctor.model';

@Component({
  selector: 'app-manage-assignments',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-assignments.component.html',
  styleUrls: ['./manage-assignments.component.scss']
})
export class ManageAssignmentsComponent implements OnInit {
  assignments: DoctorAssignmentItem[] = [];
  filteredAssignments: DoctorAssignmentItem[] = [];
  doctors: AssignmentDoctorSummary[] = [];
  patients: PatientSummary[] = [];

  isLoading = false;
  isCreating = false;
  isReassigning = false;
  errorMsg = '';
  successMsg = '';

  // Create Assignment Form
  selectedPatientId = '';
  selectedDoctorId = '';
  createError = '';

  // Filter & Search
  searchTerm = '';
  statusFilter: 'ALL' | 'ACTIVE' | 'CLOSED' = 'ALL';

  // Reassign Modal
  showReassignModal = false;
  targetAssignment: DoctorAssignmentItem | null = null;
  reassignDoctorId = '';
  reassignError = '';

  constructor(
    private assignmentService: AssignmentService,
    private toast: ToastService
  ) {}

  ngOnInit(): void {
    this.loadAllData();
  }

  loadAllData(): void {
    this.isLoading = true;
    this.errorMsg = '';

    // Load assignments, doctors, and patients in parallel
    this.assignmentService.getAssignments()
      .pipe(finalize(() => { this.isLoading = false; }))
      .subscribe({
        next: (res) => {
          this.assignments = res.data?.assignments || [];
          this.applyFilter();
        },
        error: (err) => {
          this.errorMsg = err?.error?.message || 'Failed to load assignments.';
        }
      });

    this.assignmentService.getActiveDoctors().subscribe({
      next: (res) => {
        this.doctors = (res.data?.doctors || []).filter(d => d.status === 'ACTIVE');
      },
      error: (err) => {
        console.error('Failed to load active doctors for assignment', err);
      }
    });

    this.assignmentService.getHospitalPatients().subscribe({
      next: (res) => {
        this.patients = (res.data?.patients || []).filter(p => p.status === 'ACTIVE');
      },
      error: (err) => {
        console.error('Failed to load patients for assignment', err);
      }
    });
  }

  loadAssignmentsOnly(): void {
    this.assignmentService.getAssignments().subscribe({
      next: (res) => {
        this.assignments = res.data?.assignments || [];
        this.applyFilter();
      },
      error: (err) => {
        this.errorMsg = err?.error?.message || 'Failed to refresh assignments.';
      }
    });
  }

  applyFilter(): void {
    const term = this.searchTerm.trim().toLowerCase();
    this.filteredAssignments = this.assignments.filter((item) => {
      const matchesStatus =
        this.statusFilter === 'ALL' || item.status === this.statusFilter;

      if (!matchesStatus) {
        return false;
      }

      if (!term) {
        return true;
      }

      const patientName = item.patient?.name?.toLowerCase() || '';
      const patientNum = item.patient?.patientNumber?.toLowerCase() || '';
      const doctorName = item.doctor?.name?.toLowerCase() || '';
      const doctorSpecialty = item.doctor?.specialization?.toLowerCase() || '';
      const doctorDept = item.doctor?.department?.toLowerCase() || '';

      return (
        patientName.includes(term) ||
        patientNum.includes(term) ||
        doctorName.includes(term) ||
        doctorSpecialty.includes(term) ||
        doctorDept.includes(term)
      );
    });
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.applyFilter();
  }

  assignPatient(): void {
    this.createError = '';
    this.successMsg = '';

    if (!this.selectedPatientId) {
      this.createError = 'Please select a patient to assign.';
      return;
    }

    if (!this.selectedDoctorId) {
      this.createError = 'Please select an active doctor for this assignment.';
      return;
    }

    this.isCreating = true;
    this.assignmentService.createAssignment({
      patientId: this.selectedPatientId,
      doctorId: this.selectedDoctorId
    })
      .pipe(finalize(() => { this.isCreating = false; }))
      .subscribe({
        next: () => {
          this.toast.show('Patient successfully assigned to doctor.');
          this.successMsg = 'Patient successfully assigned.';
          this.selectedPatientId = '';
          this.selectedDoctorId = '';
          this.createError = '';
          this.loadAssignmentsOnly();
          setTimeout(() => { this.successMsg = ''; }, 4000);
        },
        error: (err) => {
          this.createError = err?.error?.message || 'Failed to assign patient. Patient may already have an active treating doctor.';
        }
      });
  }

  openReassignModal(assignment: DoctorAssignmentItem): void {
    this.targetAssignment = assignment;
    this.reassignDoctorId = '';
    this.reassignError = '';
    this.showReassignModal = true;
  }

  closeReassignModal(): void {
    this.showReassignModal = false;
    this.targetAssignment = null;
    this.reassignDoctorId = '';
    this.reassignError = '';
  }

  submitReassign(): void {
    if (!this.targetAssignment) return;

    this.reassignError = '';

    if (!this.reassignDoctorId) {
      this.reassignError = 'Please select a replacement doctor.';
      return;
    }

    if (this.targetAssignment.doctorId === this.reassignDoctorId) {
      this.reassignError = 'The patient is already assigned to this doctor. Please choose a different doctor.';
      return;
    }

    this.isReassigning = true;
    this.assignmentService.reassign(this.targetAssignment._id, {
      doctorId: this.reassignDoctorId
    })
      .pipe(finalize(() => { this.isReassigning = false; }))
      .subscribe({
        next: () => {
          this.toast.show('Patient assignment transferred successfully.');
          this.closeReassignModal();
          this.loadAssignmentsOnly();
        },
        error: (err) => {
          this.reassignError = err?.error?.message || 'Failed to reassign patient.';
        }
      });
  }

  get activeAssignmentsCount(): number {
    return this.assignments.filter(a => a.status === 'ACTIVE').length;
  }

  getDoctorInitials(name?: string): string {
    if (!name) return 'DR';
    return name
      .replace(/^Dr\.\s*/i, '')
      .split(' ')
      .map(part => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'DR';
  }

  getPatientInitials(name?: string): string {
    if (!name) return 'PT';
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'PT';
  }
}
