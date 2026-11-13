import { Injectable } from '@nestjs/common';
import { type IdentityProvider, InvalidCredentialsError, type VerifiedIdentity } from './identity-provider.js';

/** Password comune a tutti gli utenti fittizi (solo sviluppo e test). */
export const MOCK_PASSWORD = 'demo';

/** Utenti fittizi per sviluppo e test. Mai abilitato in produzione (validazione env). */
export const MOCK_USERS: Record<string, VerifiedIdentity> = {
  admin: { active: true, firstName: 'Amministratore', lastName: 'Demo' },
  'mario.rossi': { active: true, firstName: 'Mario', lastName: 'Rossi' },
  'laura.bianchi': { active: true, firstName: 'Laura', lastName: 'Bianchi' },
  'giuseppe.verdi': { active: true, firstName: 'Giuseppe', lastName: 'Verdi' },
  'anna.neri': { active: true, firstName: 'Anna', lastName: 'Neri' },
  'paolo.gialli': { active: true, firstName: 'Paolo', lastName: 'Gialli' },
  'ex.dipendente': { active: false, firstName: 'Ex', lastName: 'Dipendente' },
};

@Injectable()
export class MockIdentityProvider implements IdentityProvider {
  /** Usernames considerati usciti dall'azienda (per simulare la verifica notturna). */
  readonly departed = new Set<string>(['ex.dipendente']);

  async authenticate(username: string, password: string): Promise<VerifiedIdentity> {
    const user = MOCK_USERS[username];
    if (!user || password !== MOCK_PASSWORD) throw new InvalidCredentialsError();
    return { ...user, active: user.active && !this.departed.has(username) };
  }

  async checkActive(username: string): Promise<boolean> {
    return Boolean(MOCK_USERS[username]) && !this.departed.has(username);
  }
}
