import { inject } from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';

/**
 * Icone Material Symbols come singoli SVG ospitati localmente in
 * public/icons/ms (copiati da @material-symbols/svg-400). Il font completo
 * pesa ~4 MB: troppo per un'app mobile.
 * Per aggiungere un'icona: inserirla qui e lanciare `npm run icons -w web`.
 */
export const ICONS = [
  'directions_car', 'visibility', 'visibility_off', 'search', 'add', 'airline_seat_recline_normal', 'schedule',
  'route', 'location_on', 'person', 'chat', 'person_remove', 'close', 'check', 'link', 'arrow_back', 'send',
  'arrow_upward', 'delete', 'add_location_alt', 'home', 'add_circle', 'eco', 'star', 'star-fill',
  'admin_panel_settings', 'download', 'flag', 'settings', 'history', 'description', 'group', 'delete_forever',
  'apartment', 'verified',
] as const;

export function registerIcons(): void {
  const registry = inject(MatIconRegistry);
  const sanitizer = inject(DomSanitizer);
  for (const name of ICONS) {
    registry.addSvgIcon(name, sanitizer.bypassSecurityTrustResourceUrl(`icons/ms/${name}.svg`));
  }
}
