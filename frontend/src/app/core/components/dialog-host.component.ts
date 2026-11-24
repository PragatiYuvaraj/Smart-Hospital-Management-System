import { Component, OnDestroy, OnInit, Injector, Provider } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogService, DialogRef, DIALOG_DATA, DialogOpen } from '../services/dialog.service';
import { Subscription } from 'rxjs';

/**
 * Global host that renders dialogs opened via DialogService.
 * Enhanced with modern healthcare SaaS backdrop blur and elevation.
 */
@Component({
  selector: 'app-dialog-host',
  standalone: true,
  imports: [CommonModule],
  template: `
    <ng-container *ngIf="currentDialog">
      <div class="dialog-backdrop" (click)="onBackdropClick()"></div>
      <div class="dialog-wrapper" [style.width]="currentDialog.config?.width || null">
        <ng-container *ngComponentOutlet="currentDialog.component; injector: dialogInjector"></ng-container>
      </div>
    </ng-container>
  `,
  styles: [`
    .dialog-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(7, 31, 26, 0.48);
      backdrop-filter: blur(4px);
      z-index: 999;
      animation: fadeIn 0.15s ease-out;
    }
    .dialog-wrapper {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #ffffff;
      padding: 28px 28px 24px 28px;
      border-radius: 12px;
      border: 1px solid var(--border-light, #e2e8e4);
      box-shadow: 0 20px 25px -5px rgba(7, 31, 26, 0.15), 0 8px 10px -6px rgba(7, 31, 26, 0.08);
      z-index: 1000;
      max-width: 92vw;
      max-height: 90vh;
      overflow-y: auto;
      box-sizing: border-box;
      animation: scaleIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes scaleIn {
      from { opacity: 0; transform: translate(-50%, -48%) scale(0.97); }
      to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    }
  `]
})
export class DialogHostComponent implements OnInit, OnDestroy {
  currentDialog: DialogOpen<any> | null = null;
  dialogInjector: Injector | undefined = undefined;
  private sub: Subscription | null = null;
  private dialogSub: Subscription | null = null;

  constructor(private dialogService: DialogService, private injector: Injector) { }

  ngOnInit(): void {
    this.sub = this.dialogService.open$.subscribe((open: DialogOpen<any>) => {
      this.currentDialog = open;
      this.dialogSub?.unsubscribe();
      const providers: Provider[] = [
        { provide: DialogRef, useValue: open.dialogRef },
        { provide: DIALOG_DATA, useValue: open.config?.data }
      ];
      this.dialogInjector = Injector.create({ providers, parent: this.injector });

      this.dialogSub = open.dialogRef.afterClosed().subscribe(() => {
        if (this.currentDialog === open) {
          this.clearDialog();
        }
      });
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.dialogSub?.unsubscribe();
  }

  onBackdropClick(): void {
    if (this.currentDialog) {
      this.currentDialog.dialogRef.close();
    }
    this.clearDialog();
  }

  private clearDialog(): void {
    this.currentDialog = null;
    this.dialogInjector = undefined;
  }
}
