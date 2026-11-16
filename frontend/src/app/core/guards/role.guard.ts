import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';

/**
 * Route guard that ensures the logged-in user possesses the required role
 */
export const roleGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const expectedRoles = route.data?.['roles'] as Array<string>;
  const userRole = authService.getUserRole();

  if (userRole && expectedRoles && expectedRoles.includes(userRole)) {
    return true;
  }

  // User does not have permitted role -> redirect to default dashboard
  return router.createUrlTree(['/dashboard']);
};
