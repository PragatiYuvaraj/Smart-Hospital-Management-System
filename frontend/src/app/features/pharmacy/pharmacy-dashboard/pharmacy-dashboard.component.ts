import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { PharmacyService } from '../../../core/services/pharmacy.service';
import { User } from '../../../core/models/user.model';

@Component({
  selector: 'app-pharmacy-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './pharmacy-dashboard.component.html',
  styleUrl: './pharmacy-dashboard.component.css'
})
export class PharmacyDashboardComponent implements OnInit {
  user: User | null = null;

  pendingCount: number | null = null;
  medicineCount: number | null = null;
  loadingStats = true;
  statsError: string | null = null;

  constructor(
    private authService: AuthService,
    private pharmacyService: PharmacyService
  ) {}

  ngOnInit(): void {
    this.user = this.authService.getCurrentUser();
    this.loadStats();
  }

  loadStats(): void {
    this.loadingStats = true;
    this.statsError = null;

    // Load pending prescription count
    this.pharmacyService.getPendingPrescriptions({ limit: 1, page: 1 }).subscribe({
      next: (res) => {
        this.pendingCount = res.data.total;
        this.loadingStats = false;
      },
      error: (err) => {
        this.statsError = err?.error?.message || 'Unable to load dashboard statistics.';
        this.loadingStats = false;
      }
    });

    // Load medicine count independently
    this.pharmacyService.getMedicines({ limit: 1, page: 1 }).subscribe({
      next: (res) => {
        this.medicineCount = res.data.total;
      },
      error: () => {
        // non-critical — keep null
      }
    });
  }

  onLogout(): void {
    this.authService.logout();
  }
}
