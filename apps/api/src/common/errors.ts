import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Eccezione applicativa con codice stabile (usato dal frontend) e messaggio
 * in italiano per l'utente. Il messaggio non deve mai contenere dati personali
 * o credenziali.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ statusCode: status, code, message }, status);
  }
}

export const NotFound = (what = 'Risorsa') =>
  new AppException('NOT_FOUND', `${what} non trovata`, HttpStatus.NOT_FOUND);

export const Forbidden = (message = 'Operazione non consentita') =>
  new AppException('FORBIDDEN', message, HttpStatus.FORBIDDEN);

export const Conflict = (code: string, message: string) => new AppException(code, message, HttpStatus.CONFLICT);
