import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { inject, vi } from 'vitest';
import type { CreateTripInput, TripDetailDto } from '@fcs/shared';
import { AppModule } from '../src/app.module.js';
import { Clock } from '../src/common/clock.js';
import { PrismaService } from '../src/common/prisma.service.js';
import { loadEnv } from '../src/config/env.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { MailService, type MailMessage } from '../src/notifications/mail.service.js';
import { PushService } from '../src/notifications/push.service.js';
import { configureApp } from '../src/security.js';
import { MOCK_PASSWORD } from '../src/auth/mock-identity.provider.js';

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:4200',
  AUTH_PROVIDER: 'mock',
  DATA_ENCRYPTION_KEYS: '1:' + Buffer.alloc(32, 7).toString('base64'),
  HMAC_KEY: Buffer.alloc(32, 9).toString('base64'),
  INITIAL_GLOBAL_ADMIN: 'admin',
  LOGIN_MIN_RESPONSE_MS: '0',
  JOBS_ENABLED: 'false',
  VAPID_PUBLIC_KEY: '',
  VAPID_PRIVATE_KEY: '',
  SMTP_HOST: '',
  MAIL_TRANSPORT: 'disabled',
  ROUTING_PROVIDER: 'estimate',
  OSRM_URL: '',
  LOG_LEVEL: 'info',
};

/** Orologio controllabile: di default lunedì 16/11/2026 alle 08:00 (ora di Roma). */
export class FakeClock extends Clock {
  current = new Date('2026-11-16T07:00:00.000Z');
  override now(): Date {
    return new Date(this.current);
  }
  set(iso: string): void {
    this.current = new Date(iso);
  }
}

export interface TestContext {
  app: INestApplication;
  clock: FakeClock;
  prisma: PrismaService;
  notify: ReturnType<typeof vi.spyOn>;
  sites: { id: string; name: string }[];
}

export async function createTestApp(envOverrides: Record<string, string> = {}): Promise<TestContext> {
  Object.assign(process.env, TEST_ENV, { DATABASE_URL: inject('databaseUrl') }, envOverrides);
  const clock = new FakeClock();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  configureApp(app, loadEnv());
  await app.init();
  const prisma = app.get(PrismaService);
  const notify = vi.spyOn(app.get(NotificationsService), 'notify');
  const sites = await prisma.site.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });
  return { app, clock, prisma, notify, sites };
}

/** Ripristina tutti i mock e ricrea lo spy sulle notifiche. */
export function resetSpies(ctx: TestContext): void {
  vi.restoreAllMocks();
  ctx.notify = vi.spyOn(ctx.app.get(NotificationsService), 'notify');
}

/** Svuota le tabelle applicative (mantiene comuni, sedi e testi legali). */
export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE "ChatMessage", "ChatMute", "PushSubscription", "Invitation", "TripParticipant",
    "Trip", "TripStop", "TripSeries", "PolicyAcceptance", "ConsentEvent", "UserConsent", "RoleAssignment", "Session",
    "LoginThrottle", "Setting", "EmailVerification", "TripStatFact", "UserStatEntry", "DistanceCache", "Favorite", "AbsenceReport", "User" CASCADE`);
}

/** Client HTTP con cookie di sessione e token CSRF gestiti automaticamente. */
export class ApiClient {
  readonly agent: ReturnType<typeof request.agent>;
  xsrf = '';
  userId = '';

  constructor(private readonly app: INestApplication) {
    this.agent = request.agent(app.getHttpServer());
  }

  async init(): Promise<this> {
    const res = await this.agent.get('/api/me');
    const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const c = setCookie.find((x) => x.startsWith('XSRF-TOKEN='));
    if (c) this.xsrf = c.split(';')[0]!.split('=')[1]!;
    return this;
  }

  get(url: string) {
    return this.agent.get('/api' + url);
  }
  post(url: string, body?: object) {
    return this.agent.post('/api' + url).set('X-XSRF-TOKEN', this.xsrf).send(body ?? {});
  }
  patch(url: string, body?: object) {
    return this.agent.patch('/api' + url).set('X-XSRF-TOKEN', this.xsrf).send(body ?? {});
  }
  put(url: string, body?: object) {
    return this.agent.put('/api' + url).set('X-XSRF-TOKEN', this.xsrf).send(body ?? {});
  }
  delete(url: string, body?: object) {
    return this.agent.delete('/api' + url).set('X-XSRF-TOKEN', this.xsrf).send(body ?? {});
  }

  login(username: string, password = MOCK_PASSWORD) {
    return this.post('/auth/login', { username, password });
  }
}

export const COMUNI = {
  MILANO: '015146',
  MONZA: '108033',
  SESTO_SG: '015209',
  BERGAMO: '016024',
};

/** Spy sull'invio effettivo delle email (il trasporto nei test è 'disabled'). */
export function mailSpy(ctx: TestContext) {
  return vi.spyOn(ctx.app.get(MailService), 'deliver');
}

/** Estrae il codice di verifica dall'ultima email inviata a 	o. */
export function lastCodeFor(spy: ReturnType<typeof mailSpy>, to: string): string {
  const msg = spy.mock.calls.map((c) => c[0] as MailMessage).filter((m) => m.to === to).at(-1);
  const code = msg?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error('nessun codice inviato a ' + to);
  return code;
}

/** Richiede e conferma il codice per l'email delle notifiche. */
export async function verifyEmail(ctx: TestContext, c: ApiClient, email: string): Promise<void> {
  const spy = mailSpy(ctx);
  const req = await c.post('/profile/email/code', { email });
  if (req.status !== 200) throw new Error(`richiesta codice fallita: ${req.status} ${JSON.stringify(req.body)}`);
  const res = await c.post('/profile/email/confirm', { code: lastCodeFor(spy, email) });
  if (res.status !== 200) throw new Error(`conferma email fallita: ${res.status} ${JSON.stringify(res.body)}`);
}

/** Login + onboarding completo (email verificata, informativa, termini, sede, comune). */
export async function onboardedUser(
  ctx: TestContext,
  username: string,
  consents: Partial<{ phoneVisible: boolean; discoverable: boolean; optionalNotifications: boolean }> = {},
): Promise<ApiClient> {
  const c = await new ApiClient(ctx.app).init();
  const login = await c.login(username);
  if (login.status !== 204) throw new Error(`login ${username} fallito: ${login.status}`);
  await verifyEmail(ctx, c, `${username}@example.test`);
  const policies = (await c.get('/policies/current')).body as { id: string }[];
  const me = await c.post('/onboarding', {
    acceptedPolicyIds: policies.map((p) => p.id),
    consents: { phoneVisible: false, discoverable: false, optionalNotifications: false, ...consents },
    siteId: ctx.sites[0]!.id,
    comuneIstat: COMUNI.MONZA,
  });
  if (me.status !== 201) throw new Error(`onboarding ${username} fallito: ${me.status} ${JSON.stringify(me.body)}`);
  c.userId = me.body.id;
  return c;
}

export function tripInput(ctx: TestContext, overrides: Partial<CreateTripInput> = {}): CreateTripInput {
  return {
    siteId: ctx.sites[0]!.id,
    date: '2026-11-20',
    arrivalTime: '08:30',
    returnTime: '17:30',
    departureComune: COMUNI.BERGAMO,
    viaComuni: [COMUNI.MONZA, COMUNI.SESTO_SG],
    seats: 3,
    visibility: 'PUBLIC',
    meetingPoint: 'Parcheggio della stazione',
    ...overrides,
  };
}

export async function createTrip(ctx: TestContext, driver: ApiClient, overrides: Partial<CreateTripInput> = {}): Promise<TripDetailDto> {
  const res = await driver.post('/trips', tripInput(ctx, overrides));
  if (res.status !== 201) throw new Error(`creazione viaggio fallita: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as TripDetailDto;
}

export function pushSpy(ctx: TestContext) {
  return vi.spyOn(ctx.app.get(PushService), 'sendToUser');
}
