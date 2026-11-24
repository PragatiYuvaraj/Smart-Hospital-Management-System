export type VaultDocumentStatus = 'ACTIVE' | 'DELETED';

export interface VaultDocument {
  _id: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
  status: VaultDocumentStatus;
}

export interface VaultPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface VaultDocumentListResponse {
  success: boolean;
  message: string;
  data: {
    documents: VaultDocument[];
    pagination: VaultPagination;
  };
}

export interface VaultDocumentUploadResponse {
  success: boolean;
  message: string;
  data: {
    document: VaultDocument;
  };
}

export interface VaultDocumentDeleteResponse {
  success: boolean;
  message: string;
  data: {
    document: VaultDocument;
  };
}
