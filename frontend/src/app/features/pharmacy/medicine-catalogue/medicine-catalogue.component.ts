import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { PharmacyService } from '../../../core/services/pharmacy.service';
import { Medicine, MedicineAvailability } from '../../../core/models/pharmacy.model';

type ActiveTab = 'catalogue' | 'availability';

@Component({
  selector: 'app-medicine-catalogue',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './medicine-catalogue.component.html',
  styleUrl: './medicine-catalogue.component.css'
})
export class MedicineCatalogueComponent implements OnInit {
  activeTab: ActiveTab = 'catalogue';

  // Catalogue tab state
  medicines: Medicine[] = [];
  catalogueTotal = 0;
  cataloguePage = 1;
  catalogueTotalPages = 1;

  // Availability tab state
  availabilityMedicines: MedicineAvailability[] = [];
  availabilityTotal = 0;
  availabilityPage = 1;
  availabilityTotalPages = 1;
  expandedMedicineId: string | null = null;

  readonly pageSize = 20;
  searchTerm = '';
  isLoading = false;
  errorMessage: string | null = null;

  // Stock receipt state
  showReceiptModal = false;
  isSubmittingReceipt = false;
  receiptSuccessMessage: string | null = null;
  receiptErrorMessage: string | null = null;

  receiptMedicineId = '';
  receiptBatchNumber = '';
  receiptExpiryDate = '';
  receiptQuantity: number | null = null;
  receiptSupplier = '';

  constructor(private pharmacyService: PharmacyService) {}

  ngOnInit(): void {
    this.loadCatalogue();
  }

  switchTab(tab: ActiveTab): void {
    this.activeTab = tab;
    this.searchTerm = '';
    this.errorMessage = null;
    if (tab === 'catalogue') {
      this.cataloguePage = 1;
      this.loadCatalogue();
    } else {
      this.availabilityPage = 1;
      this.loadAvailability();
    }
  }

  onSearch(): void {
    if (this.activeTab === 'catalogue') {
      this.cataloguePage = 1;
      this.loadCatalogue();
    } else {
      this.availabilityPage = 1;
      this.loadAvailability();
    }
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.onSearch();
  }

  loadCatalogue(): void {
    this.isLoading = true;
    this.errorMessage = null;
    this.pharmacyService
      .getMedicines({
        page: this.cataloguePage,
        limit: this.pageSize,
        search: this.searchTerm.trim() || undefined
      })
      .subscribe({
        next: (res) => {
          this.medicines = res.data.medicines;
          this.catalogueTotal = res.data.total;
          this.catalogueTotalPages = res.data.totalPages;
          this.isLoading = false;
        },
        error: (err) => {
          this.errorMessage = err?.error?.message || 'Failed to load medicine catalogue.';
          this.isLoading = false;
        }
      });
  }

  loadAvailability(): void {
    this.isLoading = true;
    this.errorMessage = null;
    this.pharmacyService
      .getMedicineAvailability({
        page: this.availabilityPage,
        limit: this.pageSize,
        search: this.searchTerm.trim() || undefined
      })
      .subscribe({
        next: (res) => {
          this.availabilityMedicines = res.data.medicines;
          this.availabilityTotal = res.data.total;
          this.availabilityTotalPages = res.data.totalPages;
          this.isLoading = false;
        },
        error: (err) => {
          this.errorMessage = err?.error?.message || 'Failed to load medicine availability.';
          this.isLoading = false;
        }
      });
  }

  goToPage(p: number): void {
    if (this.activeTab === 'catalogue') {
      if (p < 1 || p > this.catalogueTotalPages) return;
      this.cataloguePage = p;
      this.loadCatalogue();
    } else {
      if (p < 1 || p > this.availabilityTotalPages) return;
      this.availabilityPage = p;
      this.loadAvailability();
    }
  }

  currentPage(): number {
    return this.activeTab === 'catalogue' ? this.cataloguePage : this.availabilityPage;
  }

  currentTotalPages(): number {
    return this.activeTab === 'catalogue' ? this.catalogueTotalPages : this.availabilityTotalPages;
  }

  currentTotal(): number {
    return this.activeTab === 'catalogue' ? this.catalogueTotal : this.availabilityTotal;
  }

  currentItems(): number {
    return this.activeTab === 'catalogue'
      ? this.medicines.length
      : this.availabilityMedicines.length;
  }

  toggleAvailabilityExpand(id: string): void {
    this.expandedMedicineId = this.expandedMedicineId === id ? null : id;
  }

  isAvailabilityExpanded(id: string): boolean {
    return this.expandedMedicineId === id;
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  }

  stockClass(qty: number, reorderLevel: number): string {
    if (qty === 0) return 'stock-out';
    if (qty <= reorderLevel) return 'stock-low';
    return 'stock-ok';
  }

  openReceiptModal(medicineId?: string): void {
    this.receiptMedicineId = medicineId || (this.medicines[0]?._id ?? '');
    this.receiptBatchNumber = '';
    this.receiptExpiryDate = '';
    this.receiptQuantity = null;
    this.receiptSupplier = '';
    this.receiptErrorMessage = null;
    this.receiptSuccessMessage = null;
    this.showReceiptModal = true;
  }

  closeReceiptModal(): void {
    this.showReceiptModal = false;
    this.receiptErrorMessage = null;
  }

  resetReceiptForm(): void {
    this.receiptBatchNumber = '';
    this.receiptExpiryDate = '';
    this.receiptQuantity = null;
    this.receiptSupplier = '';
  }

  submitReceipt(): void {
    if (!this.receiptMedicineId || !this.receiptBatchNumber.trim() || !this.receiptExpiryDate || !this.receiptQuantity || this.receiptQuantity <= 0) {
      this.receiptErrorMessage = 'Please fill all required fields correctly with positive whole quantity.';
      return;
    }
    this.isSubmittingReceipt = true;
    this.receiptErrorMessage = null;
    this.receiptSuccessMessage = null;

    this.pharmacyService.recordStockReceipt({
      medicineId: this.receiptMedicineId,
      batchNumber: this.receiptBatchNumber.trim().toUpperCase(),
      expiryDate: this.receiptExpiryDate,
      receivedQuantity: Math.floor(this.receiptQuantity),
      supplierReference: this.receiptSupplier.trim() || undefined
    }).subscribe({
      next: (res) => {
        this.receiptSuccessMessage = `Stock receipt recorded for batch ${res.data.batch.batchNumber} (${res.data.batch.receivedQuantity} units).`;
        this.isSubmittingReceipt = false;
        this.resetReceiptForm();
        this.loadCatalogue();
        if (this.activeTab === 'availability') {
          this.loadAvailability();
        }
      },
      error: (err) => {
        this.receiptErrorMessage = err?.error?.message || 'Failed to record stock receipt.';
        this.isSubmittingReceipt = false;
      }
    });
  }
}
