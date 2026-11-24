import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { DialogService } from '../../core/services/dialog.service';
import { ToastService } from '../../core/services/toast.service';
import { UserService, ListUsersResponse } from '../../core/services/user.service';
import { AuthService } from '../../core/auth/auth.service';
import { CreateDoctorDialogComponent } from './create-doctor-dialog.component';
import { CreatePharmacyDialogComponent } from './create-pharmacy-dialog.component';
import { EditPermissionsDialogComponent } from './edit-permissions-dialog.component';
import { finalize } from 'rxjs/operators';

interface StaffUser {
  _id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  permissions: string[];
  updating?: boolean;
}

@Component({
  selector: 'app-staff-management',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './staff-management.component.html',
  styleUrls: ['./staff-management.component.scss']
})
export class StaffManagementComponent implements OnInit {
  staff: StaffUser[] = [];
  isLoading = false;
  errorMsg = '';
  currentUserId: string | null = null;
  searchTerm = '';
  filteredStaff: StaffUser[] = [];

  constructor(
    private userSrv: UserService,
    private auth: AuthService,
    private dialog: DialogService,
    private toast: ToastService
  ) {}

  ngOnInit(): void {
    const cur = this.auth.getCurrentUser();
    this.currentUserId = cur ? cur._id : null;
    this.loadStaff();
  }

  applyFilter(term?: string): void {
    const q = (term !== undefined ? term : this.searchTerm).trim().toLowerCase();
    this.searchTerm = q;
    this.filteredStaff = q ? this.staff.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) : this.staff;
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.filteredStaff = this.staff;
  }

  loadStaff(): void {
    this.isLoading = true;
    this.errorMsg = '';
    this.userSrv.listUsers()
      .pipe(finalize(() => (this.isLoading = false)))
      .subscribe({
        next: (res: ListUsersResponse) => {
          this.staff = (res.data.users as any) || [];
          this.applyFilter(this.searchTerm);
        },
        error: err => {
          this.errorMsg = err?.error?.message ?? 'Failed to load staff.';
        }
      });
  }

  openCreateDoctor(): void {
    const ref = this.dialog.open(CreateDoctorDialogComponent, { width: '500px' });
    ref.afterClosed().subscribe(result => {
      if (result) this.loadStaff();
    });
  }

  openCreatePharmacy(): void {
    const ref = this.dialog.open(CreatePharmacyDialogComponent, { width: '400px' });
    ref.afterClosed().subscribe(result => {
      if (result) this.loadStaff();
    });
  }

  openEditPermissions(user: StaffUser): void {
    const ref = this.dialog.open(EditPermissionsDialogComponent, { width: '500px', data: user });
    ref.afterClosed().subscribe(updated => {
      if (updated) this.loadStaff();
    });
  }

  toggleStatus(user: StaffUser): void {
    if (user._id === this.currentUserId) {
      this.toast.show('You cannot change your own account status.', 3000);
      return;
    }
    const newStatus = user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const confirmMsg = newStatus === 'INACTIVE'
      ? `Deactivate ${user.name} (${user.email})?`
      : `Activate ${user.name} (${user.email})?`;
    if (!window.confirm(confirmMsg)) return;
    user.updating = true;
    this.userSrv.updateUserStatus(user._id, { status: newStatus })
      .pipe(finalize(() => (user.updating = false)))
      .subscribe({
        next: () => {
          this.toast.show(`User ${newStatus.toLowerCase()} successfully.`, 2000);
          this.loadStaff();
        },
        error: err => {
          this.toast.show(err?.error?.message ?? 'Failed to update status.', 3000);
        }
      });
  }
}
