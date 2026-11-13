/**
 * Contratto del sistema di identità aziendale. Il resto dell'app non conosce
 * il meccanismo di autenticazione: in futuro un modulo OIDC potrà creare la
 * stessa sessione applicativa senza toccare nient'altro.
 */
export interface VerifiedIdentity {
  active: boolean;
  firstName: string;
  lastName: string;
}

export interface IdentityProvider {
  /**
   * Verifica le credenziali. La password va usata solo per la chiamata e mai
   * salvata, loggata, inclusa in errori o messa in cache.
   * @throws InvalidCredentialsError se le credenziali non sono valide
   * @throws IdentityProviderUnavailableError se il sistema non risponde
   */
  authenticate(username: string, password: string): Promise<VerifiedIdentity>;

  /** Verifica, senza password, se l'utente è ancora un dipendente attivo (se l'API lo consente). */
  checkActive?(username: string): Promise<boolean>;
}

export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');

/** Credenziali non valide o utente inesistente (indistinguibili per scelta). */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('Credenziali non valide');
    this.name = 'InvalidCredentialsError';
  }
}

/** Il sistema di identità non è raggiungibile o ha risposto in modo inatteso. */
export class IdentityProviderUnavailableError extends Error {
  constructor(reason: string) {
    // reason è un codice interno, mai testo proveniente dall'API esterna.
    super(`Sistema di autenticazione non disponibile (${reason})`);
    this.name = 'IdentityProviderUnavailableError';
  }
}
