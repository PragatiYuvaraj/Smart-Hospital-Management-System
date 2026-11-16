import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';

/**
 * Route guard that prevents unauthenticated users from accessing protected pages
 */
export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.getToken()) {
    return true;
  }

  // Not logged in -> redirect to login page with return url
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};
