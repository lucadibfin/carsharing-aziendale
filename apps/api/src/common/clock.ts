import { Injectable } from '@nestjs/common';

/** Sorgente dell'ora corrente, sostituibile nei test. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
