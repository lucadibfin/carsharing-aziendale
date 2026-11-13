import { Injectable } from '@nestjs/common';

type Listener = (seriesId: string, userId: string) => Promise<void> | void;

/**
 * Notifica al gateway della chat che l'appartenenza di un utente a una serie
 * è cambiata (es. partecipazione annullata), così le sue connessioni attive
 * vengono rimosse dalla stanza. Evita una dipendenza circolare trips ↔ chat.
 */
@Injectable()
export class ChatMembershipEvents {
  private readonly listeners: Listener[] = [];

  onChange(l: Listener): void {
    this.listeners.push(l);
  }

  async membershipChanged(seriesId: string, userId: string): Promise<void> {
    for (const l of this.listeners) await l(seriesId, userId);
  }
}
