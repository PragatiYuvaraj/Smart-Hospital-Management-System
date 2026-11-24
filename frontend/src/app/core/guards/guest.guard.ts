import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from '../auth/auth.service';

export const guestGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.getToken()) {
    return true;
  }

  return authService.ensureAuthenticatedUser().pipe(
    map((user) => user ? router.createUrlTree([authService.getRoleHome(user.role)]) : true),
    catchError(() => of(true))
  );
};
