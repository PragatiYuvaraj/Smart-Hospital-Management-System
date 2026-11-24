import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { DialogRef } from '../../core/services/dialog.service';
import { UserService } from '../../core/services/user.service';
import { ToastService } from '../../core/services/toast.service';
import { finalize } from 'rxjs/operators';

@Component({
  selector: 'app-create-doctor-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './create-doctor-dialog.component.html',
  styleUrls: ['./create-doctor-dialog.component.scss']
})
export class CreateDoctorDialogComponent {
  form: FormGroup;
  isSaving = false;
  readonly permissionOptions = ['DUTY_DOCTOR', 'VAULT_ACCESS'];

  constructor(
    private fb: FormBuilder,
    private userSrv: UserService,
    private toast: ToastService,
    private dialogRef: DialogRef<any>
  ) {
    this.form = this.fb.group({
      name: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required]],
      DUTY_DOCTOR: [false],
      VAULT_ACCESS: [false]
    });
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const payload = {
      name: this.form.value.name.trim(),
      email: this.form.value.email.trim(),
      password: this.form.value.password,
      role: 'DOCTOR' as const,
      permissions: this.permissionOptions.filter(p => this.form.value[p])
    };
    this.isSaving = true;
    this.userSrv.createUser(payload as any)
      .pipe(finalize(() => (this.isSaving = false)))
      .subscribe({
        next: () => {
          this.toast.show('Doctor account created.', 2000);
          this.dialogRef.close(true);
        },
        error: err => {
          this.toast.show(err?.error?.message ?? 'Failed to create doctor.', 3000);
        }
      });
  }
}
