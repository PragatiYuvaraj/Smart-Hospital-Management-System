import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { catchError, map, of } from 'rxjs';

/**
 * Route guard that prevents unauthenticated users from accessing protected pages
 */
export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const loginUrl = router.createUrlTree(['/login'], {
    queryParams: { returnUrl: state.url }
  });

  if (!authService.getToken()) {
    return loginUrl;
  }

  return authService.ensureAuthenticatedUser().pipe(
    map((user) => user
      ? true
      : router.createUrlTree(['/login'], {
          queryParams: { returnUrl: state.url, sessionExpired: 'true' }
        })),
    catchError(() => of(router.createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url, sessionCheckFailed: 'true' }
    })))
  );
};
