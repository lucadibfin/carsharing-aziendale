// Schemi zod condivisi: validano l'input lato API (StandardSchemaValidationPipe)
// e i form lato Angular. I tipi TypeScript sono derivati dagli schemi.
import { z } from 'zod';
// Solo la lingua italiana (z.locales le includerebbe tutte nel bundle del frontend).
import it from 'zod/v4/locales/it.js';
import { FuelType, InvitationScope, TripVisibility } from './enums.js';
import { QUICK_MESSAGE_CODES } from './quick-messages.js';

// Messaggi di validazione in italiano, sia nell'API sia nel frontend.
z.config(it());

// ---------- primitive ----------
export const istatCode = z.string().regex(/^\d{6}$/, 'Codice ISTAT non valido');
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data non valida (AAAA-MM-GG)');
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Orario non valido (HH:MM)');
export const id = z.uuid();
const trimmed = (max: number) => z.string().trim().max(max);

// ---------- autenticazione ----------
// Lo username Ã¨ normalizzato (trim + minuscole). Si accettano solo i caratteri
// tipici di sAMAccountName/UPN, cosÃ¬ input anomali non arrivano mai all'API AD.
export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Inserisci lo username')
    .max(128)
    .regex(/^[a-z0-9._\-@\\]+$/, 'Username non valido'),
  password: z.string().min(1, 'Inserisci la password').max(256),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---------- consensi e onboarding ----------
export const consentsSchema = z.object({
  phoneVisible: z.boolean(),
  discoverable: z.boolean(),
  optionalNotifications: z.boolean(),
});
export type ConsentsInput = z.infer<typeof consentsSchema>;

export const updateConsentsSchema = consentsSchema.partial();
export type UpdateConsentsInput = z.infer<typeof updateConsentsSchema>;

export const acceptPoliciesSchema = z.object({
  policyIds: z.array(id).min(1),
});
export type AcceptPoliciesInput = z.infer<typeof acceptPoliciesSchema>;

export const onboardingSchema = z.object({
  acceptedPolicyIds: z.array(id).min(1),
  consents: consentsSchema,
  siteId: id,
  comuneIstat: istatCode,
});
export type OnboardingInput = z.infer<typeof onboardingSchema>;

// ---------- email per le notifiche ----------
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Indirizzo email troppo lungo')
  .pipe(z.email('Indirizzo email non valido'));

/** Richiede l'invio di un codice di verifica al nuovo indirizzo. */
export const requestEmailCodeSchema = z.object({ email: emailSchema });
export type RequestEmailCodeInput = z.infer<typeof requestEmailCodeSchema>;

export const EMAIL_CODE_LENGTH = 6;
export const confirmEmailCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${EMAIL_CODE_LENGTH}}$`), `Il codice Ã¨ di ${EMAIL_CODE_LENGTH} cifre`),
});
export type ConfirmEmailCodeInput = z.infer<typeof confirmEmailCodeSchema>;

// ---------- profilo ----------
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ]{6,20}$/, 'Numero di telefono non valido');

export const updateProfileSchema = z.object({
  siteId: id.optional(),
  comuneIstat: istatCode.optional(),
  phone: phoneSchema.nullable().optional(),
  fuelType: z.enum(FuelType).nullable().optional(),
  // litri (o kWh per elettrico) ogni 100 km
  consumptionPer100km: z.number().positive().max(50).nullable().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ---------- viaggi ----------
/** Giorni ISO della settimana: 1 = lunedÃ¬ â€¦ 7 = domenica. */
export const WEEKDAY_LABELS: Record<number, string> = { 1: 'lun', 2: 'mar', 3: 'mer', 4: 'gio', 5: 'ven', 6: 'sab', 7: 'dom' };
/** Durata massima di una serie ricorrente con data di fine (giorni). */
export const MAX_SERIES_DAYS = 366;

export const createTripSchema = z
  .object({
    siteId: id,
    /** Data del viaggio; per una serie ricorrente Ã¨ la data di inizio. */
    date: isoDate,
    /** Serie ricorrente: giorni della settimana. Vuoto = viaggio singolo. */
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
    /** Ultima data della serie (inclusa). Assente = senza scadenza, finchÃ© il conducente non la termina. */
    endDate: isoDate.nullable().optional(),
    arrivalTime: hhmm,
    returnTime: hhmm.nullable().optional(),
    departureComune: istatCode,
    viaComuni: z.array(istatCode).max(10).default([]),
    meetingPoint: trimmed(200).optional(),
    seats: z.number().int().min(1).max(8),
    visibility: z.enum(TripVisibility),
    notes: trimmed(500).optional(),
  })
  .refine((t) => !t.returnTime || t.returnTime > t.arrivalTime, {
    message: 'Lâ€™orario di ripartenza deve essere successivo a quello di arrivo',
    path: ['returnTime'],
  })
  .refine((t) => new Set([t.departureComune, ...t.viaComuni]).size === t.viaComuni.length + 1, {
    message: 'I comuni del percorso non possono ripetersi',
    path: ['viaComuni'],
  })
  .refine((t) => new Set(t.weekdays).size === t.weekdays.length, {
    message: 'I giorni della settimana non possono ripetersi',
    path: ['weekdays'],
  })
  .refine((t) => !t.endDate || t.weekdays.length > 0, {
    message: 'La data di fine vale solo per i viaggi ricorrenti',
    path: ['endDate'],
  })
  .refine((t) => !t.endDate || t.endDate >= t.date, {
    message: 'La data di fine deve seguire quella di inizio',
    path: ['endDate'],
  });
export type CreateTripInput = z.infer<typeof createTripSchema>;

export const searchTripsSchema = z.object({
  siteId: id,
  date: isoDate,
  comuneIstat: istatCode.optional(),
});
export type SearchTripsInput = z.infer<typeof searchTripsSchema>;

export const updateVisibilitySchema = z.object({
  visibility: z.enum(TripVisibility),
  /** Serie ricorrenti: TRIP cambia solo questa data, SERIES tutte le date future. */
  scope: z.enum(InvitationScope).default('SERIES'),
});
export type UpdateVisibilityInput = z.infer<typeof updateVisibilitySchema>;

export const joinRequestSchema = z.object({
  boardingComune: istatCode,
  /** Se il viaggio Ã¨ al completo, entra in lista d'attesa invece di ricevere un errore. */
  waitlist: z.boolean().optional(),
});
export type JoinRequestInput = z.infer<typeof joinRequestSchema>;

export const closeTripSchema = z.object({
  presentParticipantIds: z.array(id),
});
export type CloseTripInput = z.infer<typeof closeTripSchema>;

// ---------- segnalazioni di assenza ----------
export const createAbsenceReportSchema = z.object({
  reportedUserId: id,
  reason: z
    .string()
    .trim()
    .min(10, 'Descrivi brevemente cosa Ã¨ successo (almeno 10 caratteri)')
    .max(1000),
});
export type CreateAbsenceReportInput = z.infer<typeof createAbsenceReportSchema>;

export const decideAbsenceReportSchema = z.object({
  status: z.enum(['DISMISSED', 'ACKNOWLEDGED']),
  note: trimmed(1000).optional(),
});
export type DecideAbsenceReportInput = z.infer<typeof decideAbsenceReportSchema>;

// ---------- inviti ----------
export const inviteUserSchema = z.object({
  userId: id,
  /** SERIES: invito a entrare nel gruppo fisso di una serie ricorrente. */
  scope: z.enum(InvitationScope).default('TRIP'),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const createInviteLinkSchema = z.object({
  expiresInHours: z.number().int().min(1).max(24 * 30).default(72),
  scope: z.enum(InvitationScope).default('TRIP'),
});
export type CreateInviteLinkInput = z.infer<typeof createInviteLinkSchema>;

export const respondInvitationSchema = z.object({
  boardingComune: istatCode,
});
export type RespondInvitationInput = z.infer<typeof respondInvitationSchema>;

export const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/);

export const userSearchSchema = z.object({
  q: z.string().trim().min(2).max(60),
});

// ---------- chat ----------
export const sendChatMessageSchema = z
  .object({
    tripId: id,
    text: trimmed(1000).min(1).optional(),
    quickCode: z.enum(QUICK_MESSAGE_CODES as [string, ...string[]]).optional(),
  })
  .refine((m) => Boolean(m.text) !== Boolean(m.quickCode), {
    message: 'Specificare un testo oppure un messaggio rapido',
  });
export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;

export const muteChatSchema = z.object({ muted: z.boolean() });

// ---------- area amministrativa ----------
const optionalId = id.optional();
/** Periodo (date incluse). Default lato API: dall'inizio dell'anno a oggi. */
const period = {
  from: isoDate.optional(),
  to: isoDate.optional(),
};

export const ADMIN_TRIP_STATES = ['upcoming', 'awaiting', 'closed', 'cancelled'] as const;
export const adminTripsQuerySchema = z.object({
  siteId: optionalId,
  ...period,
  state: z.enum(ADMIN_TRIP_STATES).optional(),
});
export type AdminTripsQuery = z.infer<typeof adminTripsQuerySchema>;

export const dashboardQuerySchema = z.object({ siteId: optionalId, ...period });
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export const exportQuerySchema = z.object({ siteId: optionalId, ...period, format: z.enum(EXPORT_FORMATS) });
export type ExportQuery = z.infer<typeof exportQuerySchema>;

export const adminReportsQuerySchema = z.object({
  siteId: optionalId,
  status: z.enum(['OPEN', 'DISMISSED', 'ACKNOWLEDGED']).optional(),
});
export type AdminReportsQuery = z.infer<typeof adminReportsQuerySchema>;

export const grantRoleSchema = z
  .object({
    userId: id,
    role: z.enum(['SITE_ADMIN', 'GLOBAL_ADMIN']),
    siteId: id.nullable().optional(),
  })
  .refine((r) => (r.role === 'SITE_ADMIN') === Boolean(r.siteId), {
    message: 'Lâ€™admin di sede richiede una sede; lâ€™admin globale no',
    path: ['siteId'],
  });
export type GrantRoleInput = z.infer<typeof grantRoleSchema>;

export const adminUserSearchSchema = z.object({ q: z.string().trim().min(2).max(60) });

const latitude = z.number().min(35).max(48).nullable();
const longitude = z.number().min(6).max(19).nullable();
export const siteInputSchema = z.object({
  name: trimmed(100).min(2),
  address: trimmed(200).min(3),
  comuneIstat: istatCode,
  lat: latitude.optional(),
  lon: longitude.optional(),
  active: z.boolean().optional(),
});
export type SiteInput = z.infer<typeof siteInputSchema>;
export const updateSiteSchema = siteInputSchema.partial();
export type UpdateSiteInput = z.infer<typeof updateSiteSchema>;

export const publishPolicySchema = z.object({
  type: z.enum(['PRIVACY_NOTICE', 'TERMS']),
  title: trimmed(200).min(3),
  content: z.string().trim().min(50, 'Il testo Ã¨ troppo breve').max(100_000),
});
export type PublishPolicyInput = z.infer<typeof publishPolicySchema>;

export const auditQuerySchema = z.object({
  ...period,
  action: z.string().regex(/^[A-Z_]{3,40}$/).optional(),
  before: z.coerce.number().int().positive().optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

// ---------- push ----------
export const pushSubscriptionSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(1000),
  keys: z.object({
    p256dh: z.string().max(200),
    auth: z.string().max(100),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

// ---------- riferimenti ----------
export const comuniQuerySchema = z.object({
  q: z.string().trim().min(2).max(60),
});
