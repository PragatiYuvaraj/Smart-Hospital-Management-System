import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { DIALOG_DATA, DialogRef } from '../../core/services/dialog.service';
import { UserService } from '../../core/services/user.service';
import { ToastService } from '../../core/services/toast.service';
import { finalize } from 'rxjs/operators';

interface StaffUser {
  _id: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
}

/**
 * Dialog for editing a staff member's grantable permissions.
 * Only DOCTOR accounts (excluding CMO and self) are editable.
 * Backend only accepts 'DUTY_DOCTOR' and 'VAULT_ACCESS'.
 */
@Component({
  selector: 'app-edit-permissions-dialog',
  templateUrl: './edit-permissions-dialog.component.html',
  styleUrls: ['./edit-permissions-dialog.component.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule]
})
export class EditPermissionsDialogComponent {
  permissionsForm: FormGroup;
  isSaving = false;
  readonly grantablePermissions = ['DUTY_DOCTOR', 'VAULT_ACCESS'];

  constructor(
    public dialogRef: DialogRef<any>,
    @Inject(DIALOG_DATA) public data: StaffUser,
    private fb: FormBuilder,
    private userSrv: UserService,
    private toast: ToastService
  ) {
    const perms = this.grantablePermissions.map(p => this.data.permissions.includes(p));
    this.permissionsForm = this.fb.group({
      DUTY_DOCTOR: [perms[0]],
      VAULT_ACCESS: [perms[1]]
    });
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onSave(): void {
    const selected = this.grantablePermissions.filter(p => this.permissionsForm.get(p)?.value);
    this.isSaving = true;
    this.userSrv.updateUserPermissions(this.data._id, { permissions: selected })
      .pipe(finalize(() => this.isSaving = false))
      .subscribe({
        next: () => {
          this.toast.show('Permissions updated successfully.', 2000);
          this.dialogRef.close(true);
        },
        error: err => {
          this.toast.show(err?.error?.message ?? 'Failed to update permissions.', 3000);
        }
      });
  }
}
