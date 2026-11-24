import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { catchError, map, of } from 'rxjs';

/**
 * Route guard that ensures the logged-in doctor possesses the VAULT_ACCESS permission.
 * Non-doctors and doctors without VAULT_ACCESS are denied access.
 */
export const vaultAccessGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.ensureAuthenticatedUser().pipe(
    map((user) => {
      if (!user) {
        return router.createUrlTree(['/login']);
      }

      if (user.role === 'DOCTOR' && (user.permissions || []).includes('VAULT_ACCESS')) {
        return true;
      }

      return router.createUrlTree([authService.getRoleHome(user.role)]);
    }),
    catchError(() => of(router.createUrlTree(['/login'])))
  );
};
