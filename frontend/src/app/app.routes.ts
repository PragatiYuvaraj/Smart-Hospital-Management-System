import { Routes } from '@angular/router';
import { LoginComponent } from './features/authentication/login/login.component';
import { RegisterComponent } from './features/authentication/register/register.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { PatientProfileComponent } from './features/patient/patient-profile/patient-profile.component';
import { DoctorProfileComponent } from './features/doctor/doctor-profile/doctor-profile.component';
import { AssignedPatientsComponent } from './features/doctor/assigned-patients/assigned-patients.component';
import { DocumentVaultComponent } from './features/doctor/document-vault/document-vault.component';
import { PharmacyDashboardComponent } from './features/pharmacy/pharmacy-dashboard/pharmacy-dashboard.component';
import { PrescriptionQueueComponent } from './features/pharmacy/prescription-queue/prescription-queue.component';
import { MedicineCatalogueComponent } from './features/pharmacy/medicine-catalogue/medicine-catalogue.component';
import { authGuard } from './core/guards/auth.guard';
import { guestGuard } from './core/guards/guest.guard';
import { roleGuard } from './core/guards/role.guard';
import { vaultAccessGuard } from './core/guards/vault-access.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'login'
  },
  {
    path: 'login',
    component: LoginComponent,
    canActivate: [guestGuard]
  },
  {
    path: 'register',
    component: RegisterComponent,
    canActivate: [guestGuard]
  },
  {
    path: 'dashboard',
    component: DashboardComponent,
    canActivate: [authGuard]
  },
  {
    path: 'patient-dashboard',
    component: DashboardComponent,
    canActivate: [authGuard, roleGuard],
    data: { roles: ['PATIENT'] }
  },
  {
    path: 'patient-profile',
    component: PatientProfileComponent,
    canActivate: [authGuard, roleGuard],
    data: { roles: ['PATIENT'] }
  },
  {
    path: 'doctor-dashboard',
    component: DashboardComponent,
    canActivate: [authGuard, roleGuard],
    data: { roles: ['DOCTOR'] }
  },
  {
    path: 'doctor-profile',
    component: DoctorProfileComponent,
    canActivate: [authGuard, roleGuard],
    data: { roles: ['DOCTOR'] }
  },
  {
    path: 'doctor-patients',
    component: AssignedPatientsComponent,
    canActivate: [authGuard, roleGuard],
    data: { roles: ['DOCTOR'] }
  },
  {
    path: 'doctor-vault',
    component: DocumentVaultComponent,
    canActivate: [authGuard, roleGuard, vaultAccessGuard],
    data: { roles: ['DOCTOR'] }
  },
  {
    path: 'pharmacy-dashboard',
    component: PharmacyDashboardComponent,
    canActivate: [authGuard, roleGuard],
    data: { roles: ['PHARMACY'] }
  },
  {
    path: 'pharmacy-prescriptions',
    component: PrescriptionQueueComponent,
    canActivate: [authGuard, roleGuard],
    data: { roles: ['PHARMACY'] }
  },
  {
    path: 'pharmacy-medicines',
    component: MedicineCatalogueComponent,
    canActivate: [authGuard, roleGuard],
    data: { roles: ['PHARMACY'] }
  },
  {
    path: '**',
    redirectTo: 'login'
  }
];
