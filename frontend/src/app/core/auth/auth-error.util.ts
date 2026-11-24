import { HttpErrorResponse } from '@angular/common/http';

export function getAuthErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) {
    return fallback;
  }

  if (error.status === 0) {
    return 'Unable to reach the hospital server. Check your connection and try again.';
  }

  if (error.status >= 500) {
    return fallback;
  }

  const message = error.error?.message;
  if (typeof message === 'string' && message.trim()) {
    return message;
  }

  if (error.status === 401) {
    return 'Invalid email or password.';
  }

  if (error.status === 400) {
    return 'Please check the information you entered and try again.';
  }

  if (error.status === 403) {
    return 'This account is not authorized to sign in.';
  }

  return fallback;
}
