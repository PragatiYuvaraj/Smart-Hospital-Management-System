export type MessageStatus = 'SENT' | 'READ';
export type ConversationStatus = 'ACTIVE' | 'CLOSED';

export interface ConversationParticipantSummary {
  id: string;
  name: string;
  role: 'PATIENT' | 'DOCTOR';
}

export interface LatestMessageSummary {
  _id: string;
  senderId: string;
  body: string;
  truncated: boolean;
  createdAt: string;
  readAt: string | null;
  status: MessageStatus;
}

export interface ConversationSummary {
  _id: string;
  status: ConversationStatus;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  participants: {
    patient: ConversationParticipantSummary;
    doctor: ConversationParticipantSummary;
  };
  latestMessage: LatestMessageSummary | null;
}

export interface Message {
  _id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  status: MessageStatus;
}

export interface ConversationResponse {
  success: boolean;
  message: string;
  data: {
    conversation: ConversationSummary;
  };
}

export interface ConversationListResponse {
  success: boolean;
  message: string;
  data: {
    conversations: ConversationSummary[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface MessageListResponse {
  success: boolean;
  message: string;
  data: {
    messages: Message[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface MessageResponse {
  success: boolean;
  message: string;
  data: {
    message: Message;
  };
}
