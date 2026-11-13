import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import {
  type IdentityProvider,
  IdentityProviderUnavailableError,
  InvalidCredentialsError,
  type VerifiedIdentity,
} from './identity-provider.js';

/**
 * Adapter verso l'API aziendale di verifica delle credenziali AD.
 *
 * ⚠ Le specifiche dell'API non sono ancora definite: formato di richiesta e
 * risposta qui sotto sono IPOTESI da adattare (solo questo file).
 *  - POST {CORPORATE_AUTH_URL}  body JSON { username, password }
 *    200 → { active: boolean, firstName: string, lastName: string }
 *    401/403 → credenziali non valide
 *  - GET  {CORPORATE_CHECK_URL}?username=…  (facoltativo, senza password)
 *    200 → { active: boolean }, 404 → utente inesistente
 *
 * Regole di sicurezza:
 *  - solo HTTPS (verificato anche in env.ts), nessun redirect seguito
 *    (un redirect potrebbe portare le credenziali altrove);
 *  - nessun retry automatico (non si moltiplicano i tentativi su AD);
 *  - timeout breve;
 *  - errori mappati su codici interni, senza riportare corpo o messaggi
 *    della risposta esterna, e senza mai includere la password.
 */
const authResponseSchema = z.object({
  active: z.boolean(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
});

const checkResponseSchema = z.object({ active: z.boolean() });

@Injectable()
export class CorporateIdentityProvider implements IdentityProvider {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async authenticate(username: string, password: string): Promise<VerifiedIdentity> {
    const url = this.requireHttps(this.env.CORPORATE_AUTH_URL);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ username, password }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.env.CORPORATE_AUTH_TIMEOUT_MS),
      });
    } catch (e) {
      // Non si propaga l'errore originale: potrebbe contenere dettagli della richiesta.
      throw new IdentityProviderUnavailableError(e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network');
    }

    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel();
      throw new InvalidCredentialsError();
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new IdentityProviderUnavailableError(`http_${res.status}`);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new IdentityProviderUnavailableError('bad_json');
    }
    const parsed = authResponseSchema.safeParse(json);
    if (!parsed.success) throw new IdentityProviderUnavailableError('bad_payload');
    return parsed.data;
  }

  async checkActive(username: string): Promise<boolean> {
    if (!this.env.CORPORATE_CHECK_URL) {
      throw new IdentityProviderUnavailableError('check_not_configured');
    }
    const url = new URL(this.requireHttps(this.env.CORPORATE_CHECK_URL));
    url.searchParams.set('username', username);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(this.env.CORPORATE_AUTH_TIMEOUT_MS),
      });
    } catch {
      throw new IdentityProviderUnavailableError('network');
    }
    if (res.status === 404) {
      await res.body?.cancel();
      return false;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new IdentityProviderUnavailableError(`http_${res.status}`);
    }
    const parsed = checkResponseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new IdentityProviderUnavailableError('bad_payload');
    return parsed.data.active;
  }

  /** Difesa in profondità: rifiuta qualunque URL non https anche se la config fosse stata aggirata. */
  private requireHttps(url: string): string {
    if (!url.startsWith('https://')) throw new IdentityProviderUnavailableError('insecure_url');
    return url;
  }
}
