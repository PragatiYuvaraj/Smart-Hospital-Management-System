import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { PharmacyService } from '../../../core/services/pharmacy.service';
import { Prescription, PrescriptionItem, MedicineBatchSummary } from '../../../core/models/pharmacy.model';

@Component({
  selector: 'app-prescription-queue',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './prescription-queue.component.html',
  styleUrl: './prescription-queue.component.css'
})
export class PrescriptionQueueComponent implements OnInit {
  prescriptions: Prescription[] = [];
  total = 0;
  page = 1;
  totalPages = 1;
  readonly pageSize = 10;

  searchTerm = '';
  isLoading = false;
  errorMessage: string | null = null;

  expandedId: string | null = null;

  // Dispensing modal state
  showDispenseModal = false;
  isSubmittingDispense = false;
  dispenseSuccessMessage: string | null = null;
  dispenseErrorMessage: string | null = null;

  selectedRx: Prescription | null = null;
  selectedItem: PrescriptionItem | null = null;
  availableBatches: MedicineBatchSummary[] = [];
  isLoadingBatches = false;
  selectedBatchId = '';
  dispenseQuantity: number | null = null;

  constructor(private pharmacyService: PharmacyService) {}

  ngOnInit(): void {
    this.loadPrescriptions();
  }

  loadPrescriptions(): void {
    this.isLoading = true;
    this.errorMessage = null;

    this.pharmacyService
      .getPendingPrescriptions({
        page: this.page,
        limit: this.pageSize,
        search: this.searchTerm.trim() || undefined
      })
      .subscribe({
        next: (res) => {
          this.prescriptions = res.data.prescriptions;
          this.total = res.data.total;
          this.totalPages = res.data.totalPages;
          this.isLoading = false;
        },
        error: (err) => {
          this.errorMessage =
            err?.error?.message || 'Failed to load prescription queue. Please try again.';
          this.isLoading = false;
        }
      });
  }

  onSearch(): void {
    this.page = 1;
    this.loadPrescriptions();
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.page = 1;
    this.loadPrescriptions();
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages) return;
    this.page = p;
    this.loadPrescriptions();
  }

  toggleExpand(id: string): void {
    this.expandedId = this.expandedId === id ? null : id;
  }

  isExpanded(id: string): boolean {
    return this.expandedId === id;
  }

  remainingQty(item: PrescriptionItem): number {
    return item.quantity - (item.dispensedQuantity || 0);
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  }

  statusClass(status: string): string {
    return status.toLowerCase().replace('_', '-');
  }

  openDispenseModal(rx: Prescription, item: PrescriptionItem): void {
    if (!item.medicine?._id) return;
    this.selectedRx = rx;
    this.selectedItem = item;
    this.selectedBatchId = '';
    this.dispenseQuantity = this.remainingQty(item);
    this.dispenseErrorMessage = null;
    this.availableBatches = [];
    this.showDispenseModal = true;
    this.isLoadingBatches = true;

    this.pharmacyService.getMedicineAvailability({ medicineId: item.medicine._id }).subscribe({
      next: (res) => {
        const med = res.data.medicines.find(m => m._id === item.medicine!._id) || res.data.medicines[0];
        if (med && med.batches) {
          this.availableBatches = med.batches.filter(b => !b.isExpired && b.availableQuantity > 0);
          if (this.availableBatches.length > 0) {
            this.selectedBatchId = this.availableBatches[0]._id;
          }
        }
        this.isLoadingBatches = false;
      },
      error: (err) => {
        this.dispenseErrorMessage = err?.error?.message || 'Failed to check batch availability.';
        this.isLoadingBatches = false;
      }
    });
  }

  closeDispenseModal(): void {
    this.showDispenseModal = false;
    this.selectedRx = null;
    this.selectedItem = null;
    this.dispenseErrorMessage = null;
  }

  submitDispense(): void {
    if (!this.selectedRx || !this.selectedItem?.medicine?._id || !this.selectedBatchId || !this.dispenseQuantity || this.dispenseQuantity <= 0) {
      this.dispenseErrorMessage = 'Please select a batch and enter a positive whole quantity.';
      return;
    }
    const maxQty = this.remainingQty(this.selectedItem);
    if (this.dispenseQuantity > maxQty) {
      this.dispenseErrorMessage = `Dispensed quantity cannot exceed remaining prescribed quantity (${maxQty}).`;
      return;
    }
    const batch = this.availableBatches.find(b => b._id === this.selectedBatchId);
    if (batch && this.dispenseQuantity > batch.availableQuantity) {
      this.dispenseErrorMessage = `Batch has only ${batch.availableQuantity} units available.`;
      return;
    }

    this.isSubmittingDispense = true;
    this.dispenseErrorMessage = null;

    this.pharmacyService.recordDispensing({
      prescriptionId: this.selectedRx._id,
      items: [
        {
          medicineId: this.selectedItem.medicine._id,
          quantity: Math.floor(this.dispenseQuantity),
          batches: [
            {
              batchId: this.selectedBatchId,
              quantity: Math.floor(this.dispenseQuantity)
            }
          ]
        }
      ]
    }).subscribe({
      next: (res) => {
        this.dispenseSuccessMessage = `Medicine dispensed successfully. Prescription status: ${res.data.prescription.status}`;
        this.isSubmittingDispense = false;
        this.closeDispenseModal();
        this.loadPrescriptions();
      },
      error: (err) => {
        this.dispenseErrorMessage = err?.error?.message || 'Failed to dispense prescription.';
        this.isSubmittingDispense = false;
      }
    });
  }
}
