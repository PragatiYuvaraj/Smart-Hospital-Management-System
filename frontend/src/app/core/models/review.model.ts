export type ReviewStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
export type ReviewReminderStatus = 'SCHEDULED' | 'SENT' | 'CANCELLED' | 'FAILED';

export interface ReviewSchedule {
  _id: string;
  reviewDate: string;
  instructions: string;
  status: ReviewStatus;
  reminderStatus: ReviewReminderStatus;
  reminderAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewResponse {
  success: boolean;
  message: string;
  data: {
    review: ReviewSchedule;
  };
}

export interface ReviewListResponse {
  success: boolean;
  message: string;
  data: {
    reviews: ReviewSchedule[];
    total: number;
    page: number;
    totalPages: number;
  };
}

export interface CreateReviewRequest {
  patientId: string;
  reviewDate: string;
  instructions?: string;
}

export interface RescheduleReviewRequest {
  reviewDate: string;
}

export interface HospitalTimezoneResponse {
  success: boolean;
  message: string;
  data: {
    hospitalTimezone: string;
  };
}
