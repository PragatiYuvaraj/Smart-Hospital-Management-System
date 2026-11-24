import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { catchError, map, of } from 'rxjs';
import { UserRole } from '../models/user.model';

/**
 * Route guard that ensures the logged-in user possesses the required role
 */
export const roleGuard: CanActivateFn = (route) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const expectedRoles = route.data?.['roles'] as UserRole[] | undefined;

  return authService.ensureAuthenticatedUser().pipe(
    map((user) => {
      if (!user) {
        return router.createUrlTree(['/login']);
      }

      if (expectedRoles?.includes(user.role)) {
        return true;
      }

      return router.createUrlTree([authService.getRoleHome(user.role)]);
    }),
    catchError(() => of(router.createUrlTree(['/login'])))
  );
};
