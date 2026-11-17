import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { errorMessage } from './api.service';

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly snack = inject(MatSnackBar);

  info(message: string): void {
    this.snack.open(message, 'OK', { duration: 4000 });
  }

  error(e: unknown, fallback?: string): void {
    this.snack.open(errorMessage(e, fallback), 'Chiudi', { duration: 6000, politeness: 'assertive', panelClass: 'toast-error' });
  }
}
