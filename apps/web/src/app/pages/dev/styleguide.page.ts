import { DOCUMENT } from '@angular/common';
import { Component, inject, ViewEncapsulation } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { TripSummaryDto } from '@fcs/shared';
import { BRAND } from '../../../generated/brand';
import { BRANDS_PREVIEW } from '../../../generated/brands-preview';
import { ChatMessageComponent } from '../../shared/chat-message.component';
import { NoticeBannerComponent } from '../../shared/notice-banner.component';
import { TripCardComponent } from '../../shared/trip-card.component';

const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

/**
 * Guida di stile (solo sviluppo, /dev/stile): i componenti principali in tutti i marchi,
 * affiancati. Ogni colonna applica i token del proprio marchio con [data-brand].
 */
@Component({
  selector: 'app-styleguide-page',
  encapsulation: ViewEncapsulation.None,
  imports: [
    ReactiveFormsModule, MatButtonModule, MatButtonToggleModule, MatCardModule, MatCheckboxModule, MatChipsModule,
    MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, MatSlideToggleModule,
    TripCardComponent, ChatMessageComponent, NoticeBannerComponent,
  ],
  templateUrl: './styleguide.page.html',
  styleUrl: './styleguide.page.scss',
})
export class StyleguidePage {
  private readonly snack = inject(MatSnackBar);
  protected readonly active = BRAND;
  protected readonly brands = BRANDS_PREVIEW;
  protected readonly swatches = [
    ['primary', 'on-primary'], ['primary-container', 'on-primary-container'],
    ['secondary', 'on-secondary'], ['secondary-container', 'on-secondary-container'],
    ['tertiary', 'on-tertiary'], ['tertiary-container', 'on-tertiary-container'],
    ['surface', 'on-surface'], ['surface-container', 'on-surface'], ['surface-container-high', 'on-surface-variant'],
    ['error', 'on-error'], ['error-container', 'on-error-container'], ['inverse-surface', 'inverse-on-surface'],
  ];
  protected readonly icons = [
    { file: 'icon-192.png', label: 'any 192' },
    { file: 'maskable-192.png', label: 'maskable 192', round: true },
    { file: 'apple-touch-icon-180.png', label: 'apple-touch 180', rounded: true },
    { file: 'monochrome-512.png', label: 'monochrome', dark: true },
    { file: 'badge-96.png', label: 'badge 96', dark: true },
  ];
  protected readonly required = new FormControl('', Validators.required);
  protected readonly trip: TripSummaryDto = {
    id: 'demo', seriesId: 'demo', siteId: 'demo', siteName: 'Milano', date: tomorrow, arrivalTime: '08:45', returnTime: '18:00',
    visibility: 'PRIVATE', status: 'SCHEDULED', seats: 4, seatsTaken: 1,
    driver: { id: 'u1', firstName: 'Giulia', lastName: 'Rossi' },
    stops: [{ order: 0, comuneIstat: '015146', comuneName: 'Monza' }, { order: 1, comuneIstat: '015209', comuneName: 'Sesto San Giovanni' }],
    meetingPoint: null, myRole: 'PARTICIPANT', myStatus: 'ACCEPTED',
  };

  constructor() {
    this.required.markAsTouched();
    // Token di tutti i marchi: foglio generato solo in sviluppo (vedi angular.json).
    const doc = inject(DOCUMENT);
    if (!doc.getElementById('styleguide-css')) {
      const link = doc.createElement('link');
      link.id = 'styleguide-css';
      link.rel = 'stylesheet';
      link.href = 'styleguide.css';
      doc.head.appendChild(link);
    }
  }

  protected toast(): void {
    this.snack.open(`Notifica reale del marchio attivo (${this.active.id})`, 'OK', { duration: 4000 });
  }
}
