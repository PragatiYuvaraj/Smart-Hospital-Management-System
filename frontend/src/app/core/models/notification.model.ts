export type NotificationType = 'REVIEW_REMINDER';
export type NotificationStatus = 'SCHEDULED' | 'SENT' | 'READ' | 'FAILED' | 'CANCELLED';

export interface Notification {
  _id: string;
  reviewId: string | null;
  type: NotificationType;
  title: string;
  message: string;
  scheduledAt: string;
  sentAt: string | null;
  readAt: string | null;
  status: NotificationStatus;
  createdAt: string;
}

export interface NotificationListResponse {
  success: boolean;
  message: string;
  data: {
    notifications: Notification[];
    total: number;
    page: number;
    totalPages: number;
  };
}

export interface NotificationResponse {
  success: boolean;
  message: string;
  data: {
    notification: Notification;
  };
}
