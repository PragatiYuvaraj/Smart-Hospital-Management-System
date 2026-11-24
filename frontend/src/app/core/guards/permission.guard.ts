import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { catchError, map, of } from 'rxjs';

/**
 * Route guard that ensures the logged‑in user possesses the MANAGE_USERS permission.
 * Unauthenticated users are redirected to the login page.
 * Authenticated users without the permission are redirected to their role‑specific home
 * with an `accessDenied=true` query parameter.
 */
export const permissionGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Compute redirect URL for authenticated users lacking permission.
    const deniedUrl = (role: any) =>
      router.createUrlTree([authService.getRoleHome(role as any)], {
        queryParams: { accessDenied: 'true' },
      });

  // Ensure the user is authenticated first.
  return authService.ensureAuthenticatedUser().pipe(
    map((user) => {
      if (!user) {
        // Not logged in – go to login (preserve returnUrl).
        return router.createUrlTree(['/login'], {
          queryParams: { returnUrl: state?.url },
        });
      }

      // Check for MANAGE_USERS permission.
      const hasPermission =
        user.role === 'DOCTOR' && (user.permissions || []).includes('MANAGE_USERS');

      if (hasPermission) {
        return true;
      }

      // Authenticated but lacking permission – redirect to role home with flag.
      return deniedUrl(user.role);
    }),
    catchError(() =>
      of(
        router.createUrlTree(['/login'], {
          queryParams: { returnUrl: state?.url },
        })
      )
    )
  );
};