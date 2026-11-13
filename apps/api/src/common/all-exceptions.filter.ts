import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiError } from '@fcs/shared';

/**
 * Formatta tutte le risposte di errore in modo uniforme.
 * Non include MAI il corpo della richiesta, lo stack o messaggi di sistemi
 * esterni: le eccezioni impreviste diventano un 500 generico.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') return;
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;

    let body: ApiError;
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const r = exception.getResponse();
      const obj = (typeof r === 'object' && r !== null ? r : {}) as Record<string, unknown>;
      body = {
        statusCode: status,
        code: typeof obj['code'] === 'string' ? obj['code'] : defaultCode(status),
        message: messageFor(status, obj),
      };
      if (status === HttpStatus.BAD_REQUEST && Array.isArray(obj['message'])) {
        // Errori di validazione: solo percorso e messaggio, mai i valori ricevuti.
        body.code = 'VALIDATION_ERROR';
        body.message = 'Dati non validi';
        body.errors = (obj['message'] as unknown[]).map((m) => {
          const s = String(m);
          const i = s.indexOf(': ');
          return i > 0 ? { path: s.slice(0, i), message: s.slice(i + 2) } : { message: s };
        });
      }
    } else {
      // Si registra solo il tipo di errore e lo stack (che non contiene input utente).
      const err = exception instanceof Error ? exception : new Error('Errore sconosciuto');
      this.logger.error({ errName: err.name, stack: err.stack }, 'Errore non gestito');
      body = { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Si è verificato un errore. Riprova più tardi.' };
    }
    res.status(body.statusCode).json(body);
  }
}

function defaultCode(status: number): string {
  switch (status) {
    case 400: return 'BAD_REQUEST';
    case 401: return 'UNAUTHENTICATED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 409: return 'CONFLICT';
    case 413: return 'PAYLOAD_TOO_LARGE';
    case 429: return 'TOO_MANY_REQUESTS';
    default: return status >= 500 ? 'INTERNAL_ERROR' : 'ERROR';
  }
}

function messageFor(status: number, obj: Record<string, unknown>): string {
  if (typeof obj['code'] === 'string' && typeof obj['message'] === 'string') return obj['message'];
  switch (status) {
    case 401: return 'Accesso richiesto';
    case 403: return 'Operazione non consentita';
    case 404: return 'Risorsa non trovata';
    case 429: return 'Troppe richieste. Riprova più tardi.';
    default: return status >= 500 ? 'Si è verificato un errore. Riprova più tardi.' : 'Richiesta non valida';
  }
}
