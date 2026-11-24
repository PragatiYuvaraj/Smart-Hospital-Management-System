import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { DialogRef } from '../../core/services/dialog.service';
import { UserService } from '../../core/services/user.service';
import { ToastService } from '../../core/services/toast.service';
import { finalize } from 'rxjs/operators';

@Component({
  selector: 'app-create-pharmacy-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './create-pharmacy-dialog.component.html',
  styleUrls: ['./create-pharmacy-dialog.component.scss']
})
export class CreatePharmacyDialogComponent {
  form: FormGroup;
  isSaving = false;

  constructor(
    private fb: FormBuilder,
    private userSrv: UserService,
    private toast: ToastService,
    private dialogRef: DialogRef<any>
  ) {
    this.form = this.fb.group({
      name: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required]]
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
      role: 'PHARMACY' as const,
      permissions: []
    };
    this.isSaving = true;
    this.userSrv.createUser(payload as any)
      .pipe(finalize(() => (this.isSaving = false)))
      .subscribe({
        next: () => {
          this.toast.show('Pharmacy account created.', 2000);
          this.dialogRef.close(true);
        },
        error: err => {
          this.toast.show(err?.error?.message ?? 'Failed to create pharmacy.', 3000);
        }
      });
  }
}
