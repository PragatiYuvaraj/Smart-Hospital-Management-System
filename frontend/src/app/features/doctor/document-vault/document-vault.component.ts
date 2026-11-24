import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { VaultService } from '../../../core/services/vault.service';
import { VaultDocument, VaultPagination } from '../../../core/models/vault.model';
import { HttpErrorResponse } from '@angular/common/http';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MiB
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg'];

@Component({
  selector: 'app-document-vault',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './document-vault.component.html',
  styleUrls: ['./document-vault.component.css']
})
export class DocumentVaultComponent implements OnInit {
  documents: VaultDocument[] = [];
  pagination: VaultPagination = {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0
  };

  isLoading = false;
  isUploading = false;
  downloadingDocId: string | null = null;
  deletingDocId: string | null = null;

  errorMessage: string | null = null;
  successMessage: string | null = null;

  // Selected file for upload
  selectedFile: File | null = null;
  fileValidationError: string | null = null;

  // Deletion modal state
  documentToDelete: VaultDocument | null = null;

  constructor(private vaultService: VaultService) {}

  ngOnInit(): void {
    this.loadDocuments(1);
  }

  loadDocuments(page = 1): void {
    this.isLoading = true;
    this.errorMessage = null;

    this.vaultService.getDocuments(page, this.pagination.limit).subscribe({
      next: (res) => {
        this.isLoading = false;
        if (res.success && res.data) {
          this.documents = res.data.documents || [];
          this.pagination = res.data.pagination || {
            page,
            limit: 20,
            total: this.documents.length,
            totalPages: Math.ceil(this.documents.length / 20)
          };
        }
      },
      error: (err: unknown) => {
        this.isLoading = false;
        this.errorMessage = this.extractErrorMessage(err, 'Failed to load documents.');
      }
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.fileValidationError = null;
    this.successMessage = null;

    if (!input.files || input.files.length === 0) {
      this.selectedFile = null;
      return;
    }

    const file = input.files[0];

    // Client-side file type and size validation
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    const isAllowedExt = ALLOWED_EXTENSIONS.includes(ext);
    const isAllowedMime = ALLOWED_MIME_TYPES.includes(file.type);

    if (!isAllowedExt && !isAllowedMime) {
      this.fileValidationError = 'Invalid file type. Only PDF, PNG, and JPEG files are allowed.';
      this.selectedFile = null;
      input.value = '';
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      this.fileValidationError = 'File size exceeds the 5 MiB maximum limit.';
      this.selectedFile = null;
      input.value = '';
      return;
    }

    if (file.size === 0) {
      this.fileValidationError = 'File cannot be empty.';
      this.selectedFile = null;
      input.value = '';
      return;
    }

    this.selectedFile = file;
  }

  clearSelectedFile(fileInput: HTMLInputElement): void {
    this.selectedFile = null;
    this.fileValidationError = null;
    fileInput.value = '';
  }

  uploadFile(fileInput: HTMLInputElement): void {
    if (!this.selectedFile) {
      this.fileValidationError = 'Please select a file to upload.';
      return;
    }

    this.isUploading = true;
    this.errorMessage = null;
    this.successMessage = null;
    this.fileValidationError = null;

    const fileToUpload = this.selectedFile;

    this.vaultService.uploadDocument(fileToUpload).subscribe({
      next: (res) => {
        this.isUploading = false;
        this.selectedFile = null;
        fileInput.value = '';
        this.successMessage = `Document "${res.data.document.originalFilename}" uploaded successfully.`;
        // Refresh list
        this.loadDocuments(1);
      },
      error: (err: unknown) => {
        this.isUploading = false;
        this.errorMessage = this.extractErrorMessage(err, 'Document upload failed.');
      }
    });
  }

  downloadDocument(doc: VaultDocument): void {
    if (this.downloadingDocId) return;

    this.downloadingDocId = doc._id;
    this.errorMessage = null;

    this.vaultService.downloadDocument(doc._id).subscribe({
      next: (blob: Blob) => {
        this.downloadingDocId = null;
        // Trigger browser download via object URL
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = doc.originalFilename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      },
      error: (err: unknown) => {
        this.downloadingDocId = null;
        this.errorMessage = this.extractErrorMessage(err, 'Failed to download document.');
      }
    });
  }

  confirmDelete(doc: VaultDocument): void {
    this.documentToDelete = doc;
  }

  cancelDelete(): void {
    this.documentToDelete = null;
  }

  executeDelete(): void {
    if (!this.documentToDelete) return;

    const docId = this.documentToDelete._id;
    const docName = this.documentToDelete.originalFilename;

    this.deletingDocId = docId;
    this.errorMessage = null;
    this.successMessage = null;

    this.vaultService.deleteDocument(docId).subscribe({
      next: () => {
        this.deletingDocId = null;
        this.documentToDelete = null;
        this.successMessage = `Document "${docName}" was deleted successfully.`;
        // Refresh documents list
        this.loadDocuments(this.pagination.page);
      },
      error: (err: unknown) => {
        this.deletingDocId = null;
        this.documentToDelete = null;
        this.errorMessage = this.extractErrorMessage(err, 'Failed to delete document.');
      }
    });
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.pagination.totalPages && page !== this.pagination.page) {
      this.loadDocuments(page);
    }
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  getFileTypeBadge(mimeType: string): string {
    switch (mimeType) {
      case 'application/pdf':
        return 'PDF';
      case 'image/png':
        return 'PNG';
      case 'image/jpeg':
        return 'JPEG';
      default:
        return 'FILE';
    }
  }

  private extractErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        return 'Unable to reach the hospital server. Check your connection.';
      }
      if (error.status === 403) {
        return error.error?.message || 'Access denied: The VAULT_ACCESS permission is required.';
      }
      if (error.status === 413) {
        return 'File exceeds the 5 MiB upload size limit.';
      }
      if (error.error?.message && typeof error.error.message === 'string') {
        return error.error.message;
      }
    }
    return fallback;
  }
}
