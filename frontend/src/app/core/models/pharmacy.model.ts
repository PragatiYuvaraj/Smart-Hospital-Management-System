// Pharmacy domain TypeScript interfaces — mirrors backend pharmacy.service.js response shapes

export interface PrescriptionMedicineRef {
  _id: string;
  identifier: string;
  name: string;
  strength: string;
  form: string;
}

export interface PrescriptionPatientRef {
  _id: string;
  name: string;
  patientNumber: string;
}

export interface PrescriptionDoctorRef {
  _id: string;
  name: string;
}

export interface PrescriptionItem {
  medicine: PrescriptionMedicineRef | null;
  dosage: string;
  route?: string;
  frequency: string;
  duration: string;
  quantity: number;
  dispensedQuantity: number;
  instructions?: string;
}

export type PrescriptionStatus = 'PENDING' | 'PARTIALLY_DISPENSED' | 'DISPENSED' | 'CANCELLED';

export interface Prescription {
  _id: string;
  issuedAt: string;
  status: PrescriptionStatus;
  patient: PrescriptionPatientRef | null;
  doctor: PrescriptionDoctorRef | null;
  items: PrescriptionItem[];
}

export interface PrescriptionListResponse {
  prescriptions: Prescription[];
  total: number;
  page: number;
  totalPages: number;
}

// Medicine catalogue
export interface Medicine {
  _id: string;
  identifier: string;
  name: string;
  genericName?: string;
  strength?: string;
  form: string;
  category: string;
  manufacturer?: string;
  reorderLevel: number;
  active: boolean;
  usableQuantity: number; // from getMedicines
}

export interface MedicineListResponse {
  medicines: Medicine[];
  total: number;
  page: number;
  totalPages: number;
}

// Medicine availability (extends Medicine with batch breakdown)
export interface MedicineBatchSummary {
  _id: string;
  batchNumber: string;
  expiryDate: string;
  availableQuantity: number;
  isExpired: boolean;
}

export interface MedicineAvailability extends Medicine {
  expiredQuantity: number;
  batches: MedicineBatchSummary[];
}

export interface MedicineAvailabilityResponse {
  medicines: MedicineAvailability[];
  total: number;
  page: number;
  totalPages: number;
}

// Dispensing request
export interface DispensingBatchAllocation {
  batchId: string;
  quantity: number;
}

export interface DispensingItem {
  medicineId: string;
  quantity: number;
  batches: DispensingBatchAllocation[];
}

export interface DispensingRequest {
  prescriptionId: string;
  items: DispensingItem[];
}

export interface DispensingResponse {
  prescription: {
    _id: string;
    status: PrescriptionStatus;
    items: { medicineId: string; quantity: number; dispensedQuantity: number }[];
  };
  transactions: {
    _id: string;
    medicineId: string;
    batchId: string;
    quantity: number;
    transactionType: string;
    timestamp: string;
  }[];
}

// Stock receipt request
export interface StockReceiptRequest {
  medicineId: string;
  batchNumber: string;
  expiryDate: string;        // YYYY-MM-DD
  receivedQuantity: number;
  supplierReference?: string;
}

export interface StockReceiptResponse {
  batch: {
    _id: string;
    medicineId: string;
    batchNumber: string;
    expiryDate: string;
    receivedQuantity: number;
    availableQuantity: number;
    receivedAt: string;
    supplierReference?: string;
  };
  transaction: {
    _id: string;
    transactionType: string;
    quantity: number;
    actorId: string;
    timestamp: string;
  };
}
