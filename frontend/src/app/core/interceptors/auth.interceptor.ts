import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';

const isBackendApiRequest = (url: string): { matches: boolean; path: string } => {
  const apiBase = new URL(environment.apiUrl, 'http://shms.local');
  const requestUrl = new URL(url, apiBase.origin);
  const basePath = apiBase.pathname.replace(/\/+$/, '');
  const matchesPath = requestUrl.pathname === basePath ||
    requestUrl.pathname.startsWith(`${basePath}/`);

  return {
    matches: requestUrl.origin === apiBase.origin && matchesPath,
    path: requestUrl.pathname.replace(/\/+$/, '')
  };
};

/**
 * Functional HTTP Interceptor:
 * Intercepts outgoing HTTP requests and automatically attaches the JWT Bearer token
 * to protected API requests.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const token = authService.getToken();
  const apiRequest = isBackendApiRequest(req.url);
  const isPublicAuthEndpoint = [
    `${new URL(environment.apiUrl, 'http://shms.local').pathname.replace(/\/+$/, '')}/auth/register`,
    `${new URL(environment.apiUrl, 'http://shms.local').pathname.replace(/\/+$/, '')}/auth/login`
  ].includes(apiRequest.path);
  const authReq = token && apiRequest.matches && !isPublicAuthEndpoint
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      const errorMessage = typeof error.error?.message === 'string'
        ? error.error.message.toLowerCase()
        : '';
      const invalidSession = error.status === 401 ||
        (error.status === 403 && errorMessage.startsWith('account is inactive'));

      if (apiRequest.matches && !isPublicAuthEndpoint && invalidSession) {
        const returnUrl = router.url.startsWith('/login') ? undefined : router.url;
        authService.logout();
        void router.navigate(['/login'], {
          queryParams: {
            sessionExpired: 'true',
            ...(returnUrl ? { returnUrl } : {})
          }
        });
      }
      return throwError(() => error);
    })
  );
};
