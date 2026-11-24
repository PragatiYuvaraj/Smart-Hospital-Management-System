// Minimal stubs for Angular Material modules/classes used in StaffManagementComponent
// These allow the project to compile without pulling the real @angular/material package.

export const MatDialogModule = {};
export const MatButtonModule = {};
export const MatSnackBarModule = {};
export const MatProgressSpinnerModule = {};
export const MatCheckboxModule = {};

export class MatDialog {
  open(componentOrTemplate: any, config?: any) {
    // Simple stub that returns an object with afterClosed observable
    return {
      afterClosed: () => ({
        subscribe: (cb: any) => {
          // No dialog, simply invoke callback with undefined
          cb(undefined);
        },
      }),
    };
  }
}

export class MatSnackBar {
  open(message: string, action?: string, config?: any) {
    // Simple stub: use browser alert for visibility
    // In a non-browser environment, just ignore.
    try { alert(message); } catch (e) {}
    return {};
  }
}
