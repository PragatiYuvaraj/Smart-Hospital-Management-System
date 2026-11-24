import { Injectable, Type, InjectionToken } from '@angular/core';
import { Subject, Observable } from 'rxjs';

export class DialogRef<T = any> {
  private closed$ = new Subject<T | undefined>();
  close(result?: T) {
    this.closed$.next(result);
    this.closed$.complete();
  }
  afterClosed(): Observable<T | undefined> {
    return this.closed$.asObservable();
  }
}

export const DIALOG_DATA = new InjectionToken<any>('DIALOG_DATA');

export interface DialogConfig {
  data?: any;
  width?: string;
}

export interface DialogOpen<T = any> {
  component: Type<T>;
  config?: DialogConfig;
  dialogRef: DialogRef<T>;
}

@Injectable({ providedIn: 'root' })
export class DialogService {
  private openSubject = new Subject<DialogOpen<any>>();

  open<T>(component: Type<T>, config?: DialogConfig): DialogRef<T> {
    const ref = new DialogRef<T>();
    this.openSubject.next({ component, config, dialogRef: ref });
    return ref;
  }

  get open$(): Observable<DialogOpen<any>> {
    return this.openSubject.asObservable();
  }
}
