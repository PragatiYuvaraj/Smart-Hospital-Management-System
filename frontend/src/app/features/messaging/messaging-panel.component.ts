import {
  AfterViewChecked,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../core/auth/auth.service';
import { MessagingService } from '../../core/services/messaging.service';
import {
  ConversationSummary,
  Message
} from '../../core/models/messaging.model';

const MESSAGES_PER_PAGE = 20;
const MAX_MESSAGE_LENGTH = 4000;

@Component({
  selector: 'app-messaging-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './messaging-panel.component.html',
  styleUrls: ['./messaging-panel.component.css']
})
export class MessagingPanelComponent implements
  AfterViewChecked,
  OnInit,
  OnChanges,
  OnDestroy {
  @Input() patientId: string | null = null;
  @ViewChild('messageList') private messageList?: ElementRef<HTMLOListElement>;

  conversation: ConversationSummary | null = null;
  messages: Message[] = [];
  draft = '';
  messagesPage = 1;
  messagesTotalPages = 1;
  isOpeningConversation = false;
  isLoadingMessages = false;
  isLoadingOlderMessages = false;
  isSendingMessage = false;
  readActionBusyId: string | null = null;
  conversationErrorMessage = '';
  messagesErrorMessage = '';
  actionErrorMessage = '';
  actionSuccessMessage = '';

  private initialized = false;
  private conversationRequestId = 0;
  private messageRequestId = 0;
  private scrollToLatestAfterRender = false;
  private scrollAnchorAfterRender: { height: number; top: number } | null = null;

  constructor(
    private authService: AuthService,
    private messagingService: MessagingService
  ) {}

  get isPatient(): boolean {
    return this.authService.getUserRole() === 'PATIENT';
  }

  get canOpenConversation(): boolean {
    return this.isPatient ||
      (this.authService.getUserRole() === 'DOCTOR' && !!this.patientId);
  }

  get canLoadOlderMessages(): boolean {
    return !!this.conversation &&
      this.messagesPage > 1 &&
      !this.isLoadingMessages &&
      !this.isLoadingOlderMessages;
  }

  ngOnInit(): void {
    this.initialized = true;
    this.openConversation();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.initialized && changes['patientId']) {
      this.openConversation();
    }
  }

  ngOnDestroy(): void {
    this.conversationRequestId++;
    this.messageRequestId++;
  }

  ngAfterViewChecked(): void {
    const list = this.messageList?.nativeElement;
    if (!list) return;
    if (this.scrollToLatestAfterRender) {
      list.scrollTop = list.scrollHeight;
      this.scrollToLatestAfterRender = false;
    } else if (this.scrollAnchorAfterRender) {
      list.scrollTop =
        this.scrollAnchorAfterRender.top +
        list.scrollHeight -
        this.scrollAnchorAfterRender.height;
      this.scrollAnchorAfterRender = null;
    }
  }

  openConversation(): void {
    this.conversationRequestId++;
    this.messageRequestId++;
    this.resetConversationState();
    if (!this.canOpenConversation) return;

    const requestId = this.conversationRequestId;
    this.isOpeningConversation = true;
    this.conversationErrorMessage = '';
    this.messagingService.createOrGetConversation(
      this.isPatient ? null : this.patientId
    ).subscribe({
      next: (response) => {
        if (requestId !== this.conversationRequestId) return;
        this.isOpeningConversation = false;
        if (!response.success || !response.data?.conversation) {
          this.conversationErrorMessage =
            response.message || 'Could not open this conversation.';
          return;
        }
        this.conversation = response.data.conversation;
        this.loadInitialMessages(this.conversation._id);
      },
      error: (error: unknown) => {
        if (requestId !== this.conversationRequestId) return;
        this.isOpeningConversation = false;
        this.conversationErrorMessage = this.getMessagingError(
          error,
          'Could not open this conversation. Please try again.'
        );
      }
    });
  }

  loadInitialMessages(conversationId: string): void {
    const requestId = ++this.messageRequestId;
    this.isLoadingMessages = true;
    this.isLoadingOlderMessages = false;
    this.messagesErrorMessage = '';
    this.messagingService.getMessages(conversationId, 1, MESSAGES_PER_PAGE).subscribe({
      next: (response) => {
        if (!this.isCurrentConversation(conversationId, requestId)) return;
        if (!response.success || !response.data) {
          this.isLoadingMessages = false;
          this.messagesErrorMessage =
            response.message || 'Could not load conversation messages.';
          return;
        }

        const firstPage = response.data;
        this.messagesTotalPages = Math.max(1, firstPage.totalPages);
        if (this.messagesTotalPages <= 1) {
          this.applyMessagesPage(firstPage.messages, firstPage.page);
          this.isLoadingMessages = false;
          return;
        }

        this.messagingService.getMessages(
          conversationId,
          this.messagesTotalPages,
          MESSAGES_PER_PAGE
        ).subscribe({
          next: (latestPage) => {
            if (!this.isCurrentConversation(conversationId, requestId)) return;
            this.isLoadingMessages = false;
            if (!latestPage.success || !latestPage.data) {
              this.applyMessagesPage(firstPage.messages, firstPage.page);
              this.messagesErrorMessage =
                latestPage.message || 'Could not load the latest messages.';
              return;
            }
            this.messagesTotalPages = Math.max(1, latestPage.data.totalPages);
            this.applyMessagesPage(latestPage.data.messages, latestPage.data.page);
          },
          error: (error: unknown) => {
            if (!this.isCurrentConversation(conversationId, requestId)) return;
            this.isLoadingMessages = false;
            this.applyMessagesPage(firstPage.messages, firstPage.page);
            this.messagesErrorMessage = this.getMessagingError(
              error,
              'Could not load the latest messages. Please try again.'
            );
          }
        });
      },
      error: (error: unknown) => {
        if (!this.isCurrentConversation(conversationId, requestId)) return;
        this.isLoadingMessages = false;
        this.messagesErrorMessage = this.getMessagingError(
          error,
          'Could not load conversation messages. Please try again.'
        );
      }
    });
  }

  loadOlderMessages(): void {
    const conversationId = this.conversation?._id;
    if (!conversationId || !this.canLoadOlderMessages) return;

    const requestId = this.messageRequestId;
    const page = this.messagesPage - 1;
    const currentList = this.messageList?.nativeElement;
    this.scrollAnchorAfterRender = currentList
      ? { height: currentList.scrollHeight, top: currentList.scrollTop }
      : null;
    this.isLoadingOlderMessages = true;
    this.messagesErrorMessage = '';
    this.messagingService.getMessages(
      conversationId,
      page,
      MESSAGES_PER_PAGE
    ).subscribe({
      next: (response) => {
        if (!this.isCurrentConversation(conversationId, requestId)) return;
        this.isLoadingOlderMessages = false;
        if (!response.success || !response.data) {
          this.scrollAnchorAfterRender = null;
          this.messagesErrorMessage =
            response.message || 'Could not load older messages.';
          return;
        }
        this.messagesPage = response.data.page;
        this.mergeMessages(response.data.messages);
      },
      error: (error: unknown) => {
        if (!this.isCurrentConversation(conversationId, requestId)) return;
        this.isLoadingOlderMessages = false;
        this.scrollAnchorAfterRender = null;
        this.messagesErrorMessage = this.getMessagingError(
          error,
          'Could not load older messages. Please try again.'
        );
      }
    });
  }

  sendMessage(): void {
    const conversationId = this.conversation?._id;
    const body = this.draft.trim();
    if (
      !conversationId ||
      this.conversation?.status !== 'ACTIVE' ||
      !body ||
      body.length > MAX_MESSAGE_LENGTH ||
      this.isSendingMessage
    ) return;

    this.isSendingMessage = true;
    this.actionErrorMessage = '';
    this.actionSuccessMessage = '';
    const requestId = this.conversationRequestId;
    this.messagingService.sendMessage(conversationId, body).subscribe({
      next: (response) => {
        if (requestId !== this.conversationRequestId) return;
        this.isSendingMessage = false;
        if (!response.success || !response.data?.message) {
          this.actionErrorMessage = response.message || 'Could not send this message.';
          return;
        }
        this.draft = '';
        this.actionSuccessMessage = 'Message sent.';
        this.loadInitialMessages(conversationId);
      },
      error: (error: unknown) => {
        if (requestId !== this.conversationRequestId) return;
        this.isSendingMessage = false;
        this.actionErrorMessage = this.getMessagingError(
          error,
          'Could not send this message. Please try again.'
        );
      }
    });
  }

  markAsRead(message: Message): void {
    const conversationId = this.conversation?._id;
    if (
      !conversationId ||
      this.isOwnMessage(message) ||
      message.status !== 'SENT' ||
      !!message.readAt ||
      this.readActionBusyId
    ) return;

    this.readActionBusyId = message._id;
    this.actionErrorMessage = '';
    this.actionSuccessMessage = '';
    const requestId = this.conversationRequestId;
    this.messagingService.markMessageAsRead(conversationId, message._id).subscribe({
      next: (response) => {
        if (requestId !== this.conversationRequestId) return;
        this.readActionBusyId = null;
        if (!response.success || !response.data?.message) {
          this.actionErrorMessage = response.message || 'Could not update message status.';
          return;
        }
        this.messages = this.messages.map((item) =>
          item._id === message._id ? response.data.message : item
        );
        this.actionSuccessMessage = 'Message marked as read.';
      },
      error: (error: unknown) => {
        if (requestId !== this.conversationRequestId) return;
        this.readActionBusyId = null;
        this.actionErrorMessage = this.getMessagingError(
          error,
          'Could not update message status. Please try again.'
        );
      }
    });
  }

  isOwnMessage(message: Message): boolean {
    return message.senderId === this.authService.getCurrentUser()?._id;
  }

  getMessageStatus(message: Message): string {
    if (message.status === 'READ' || message.readAt) {
      return this.isOwnMessage(message) ? 'Read' : 'Read by you';
    }
    return this.isOwnMessage(message) ? 'Sent' : 'Unread';
  }

  get conversationHeading(): string {
    if (!this.conversation) return 'Conversation';
    return this.isPatient
      ? `Messages with Dr. ${this.conversation.participants.doctor.name}`
      : `Messages with ${this.conversation.participants.patient.name}`;
  }

  private resetConversationState(): void {
    this.conversation = null;
    this.messages = [];
    this.draft = '';
    this.messagesPage = 1;
    this.messagesTotalPages = 1;
    this.isOpeningConversation = false;
    this.isLoadingMessages = false;
    this.isLoadingOlderMessages = false;
    this.isSendingMessage = false;
    this.readActionBusyId = null;
    this.conversationErrorMessage = '';
    this.messagesErrorMessage = '';
    this.actionErrorMessage = '';
    this.actionSuccessMessage = '';
    this.scrollToLatestAfterRender = false;
    this.scrollAnchorAfterRender = null;
  }

  private applyMessagesPage(messages: Message[], page: number): void {
    this.messages = [...messages];
    this.messagesPage = page;
    this.scrollToLatestAfterRender = true;
  }

  private mergeMessages(incoming: Message[]): void {
    const merged = new Map<string, Message>();
    for (const message of [...incoming, ...this.messages]) {
      merged.set(message._id, message);
    }
    this.messages = Array.from(merged.values()).sort((left, right) => {
      const timeDifference =
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      return timeDifference || left._id.localeCompare(right._id);
    });
  }

  private isCurrentConversation(conversationId: string, requestId: number): boolean {
    return requestId === this.messageRequestId &&
      this.conversation?._id === conversationId;
  }

  private getMessagingError(error: unknown, fallback: string): string {
    if (!(error instanceof HttpErrorResponse)) return fallback;
    if (error.status === 0) {
      return 'Unable to reach the hospital server. Check your connection and try again.';
    }
    if (error.status === 401) {
      return 'Your session has expired. Sign in again to continue messaging.';
    }
    if (error.status === 403) {
      return this.isPatient
        ? 'You are not authorized to access this conversation.'
        : 'You are not authorized to access this conversation. Doctors must have an active treating assignment.';
    }
    if (error.status === 404) {
      return 'This conversation is unavailable or you no longer have access to it.';
    }
    if (error.status >= 500) return fallback;

    const message = error.error?.message;
    return typeof message === 'string' && message.trim() ? message : fallback;
  }
}
