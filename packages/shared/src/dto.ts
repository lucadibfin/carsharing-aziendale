// Forme delle risposte dell'API (contratto tra backend e frontend).
import type {
  AbsenceReportStatus,
  ChatMessageKind,
  FuelType,
  InvitationScope,
  InvitationStatus,
  ParticipantStatus,
  PolicyType,
  Role,
  TripStatus,
  TripVisibility,
} from './enums.js';
import type { ConsentsInput } from './schemas.js';

export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  errors?: { path?: string; message: string }[];
}

export interface RoleDto {
  role: Role;
  siteId: string | null;
}

export interface MeDto {
  id: string;
  firstName: string;
  lastName: string;
  siteId: string | null;
  comuneIstat: string | null;
  roles: RoleDto[];
  /** true finché l'utente non ha completato informativa, termini e profilo minimo. */
  onboardingRequired: boolean;
  /** Documenti (nuove versioni) ancora da accettare. */
  pendingPolicyIds: string[];
  /** true se l'utente ha un indirizzo email verificato (richiesto per completare il primo accesso). */
  emailVerified: boolean;
  /**
   * Il comune del profilo è stato cambiato d'ufficio per fusione o incorporazione
   * (es. Castegnero → Castegnero Nanto). Avviso da mostrare finché l'utente non lo chiude.
   */
  comuneNotice: { from: string; to: string } | null;
}

/** Stato dell'email per le notifiche (visibile solo all'interessato). */
export interface EmailStatusDto {
  /** Indirizzo verificato in uso. */
  email: string | null;
  verifiedAt: string | null;
  /** Indirizzo in attesa di verifica (quello attuale resta valido fino alla conferma). */
  pendingEmail: string | null;
  pendingExpiresAt: string | null;
  /** Da quando si può chiedere un nuovo codice. */
  resendAvailableAt: string | null;
}

export interface ProfileDto {
  id: string;
  firstName: string;
  lastName: string;
  siteId: string | null;
  comuneIstat: string | null;
  phone: string | null;
  fuelType: FuelType | null;
  consumptionPer100km: number | null;
  consents: ConsentsInput;
  email: EmailStatusDto;
}

export interface PolicyDto {
  id: string;
  type: PolicyType;
  version: number;
  title: string;
  content: string;
  publishedAt: string;
}

export interface SiteDto {
  id: string;
  name: string;
  address: string;
  comuneIstat: string;
}

export interface ComuneDto {
  istat: string;
  name: string;
  province: string;
}

export interface UserSummaryDto {
  id: string;
  firstName: string;
  lastName: string;
}

export interface FavoriteDto extends UserSummaryDto {
  siteName: string | null;
}

export interface TripStopDto {
  order: number;
  comuneIstat: string;
  comuneName: string;
  /** Orario stimato di passaggio ("circa"); per il primo comune è la partenza. Null per i viaggi più vecchi. */
  passTime: string | null;
}

/** Tempi di guida verso la sede per il modulo di proposta. */
export interface RouteEstimateDto {
  /** Partenza proposta. */
  departureTime: string;
  /** Minuti di guida da ogni comune del percorso alla sede (null se mancano le coordinate). */
  driveMinutes: (number | null)[];
}

export interface TripParticipantDto {
  id: string;
  user: UserSummaryDto;
  status: ParticipantStatus;
  boardingComune: string;
  boardingComuneName: string;
  /** Presente solo per i partecipanti confermati che hanno dato il consenso, e solo a chi ha diritto di vederlo. */
  phone?: string | null;
  attended?: boolean | null;
}

export interface TripSummaryDto {
  id: string;
  seriesId: string;
  siteId: string;
  siteName: string;
  date: string;
  arrivalTime: string;
  returnTime: string | null;
  /** Partenza dal primo comune; null per i viaggi creati prima di questo campo. */
  departureTime: string | null;
  visibility: TripVisibility;
  status: TripStatus;
  seats: number;
  seatsTaken: number;
  driver: UserSummaryDto;
  stops: TripStopDto[];
  meetingPoint: string | null;
  /** Ruolo dell'utente corrente rispetto al viaggio. */
  myRole: 'DRIVER' | 'PARTICIPANT' | 'INVITED' | 'NONE';
  myStatus: ParticipantStatus | null;
  /** Serie ricorrente: giorni della settimana (1 = lun) e ultima data; null per un viaggio singolo. */
  recurrence: { weekdays: number[]; endDate: string | null } | null;
  /** L'utente corrente fa parte del gruppo fisso della serie. */
  isSeriesMember: boolean;
}

/** Una data di una serie ricorrente, vista dal conducente o da un membro fisso. */
export interface SeriesDateDto {
  tripId: string;
  date: string;
  status: TripStatus;
  visibility: TripVisibility;
  seats: number;
  seatsTaken: number;
  myStatus: ParticipantStatus | null;
}

export interface TripDetailDto extends TripSummaryDto {
  notes: string | null;
  driverPhone?: string | null;
  participants: TripParticipantDto[];
  invitations?: InvitationDto[];
  /** Invito personale in sospeso dell'utente corrente, se presente. */
  myInvitationId?: string;
  /** TRIP: invito per questa data; SERIES: invito nel gruppo fisso della serie. */
  myInvitationScope?: InvitationScope;
  canCancelWithoutPenalty: boolean;
  cancellationDeadline: string;
  /** Prossime date della serie (solo conducente e membri fissi; assente per i viaggi singoli). */
  seriesDates?: SeriesDateDto[];
  /** Gruppo fisso della serie (solo conducente e membri fissi). */
  seriesMembers?: (UserSummaryDto & { boardingComuneName: string })[];
  /** Utenti in lista d'attesa per questa data (solo il conducente vede chi sono; gli altri il numero). */
  waitlistCount: number;
}

export interface InvitationDto {
  id: string;
  tripId: string;
  scope: InvitationScope;
  status: InvitationStatus;
  invitee: UserSummaryDto | null;
  isLink: boolean;
  expiresAt: string;
  createdAt: string;
}

export interface InviteLinkDto {
  invitation: InvitationDto;
  /** Token in chiaro: viene mostrato una sola volta al conducente. */
  token: string;
}

export interface MyTripsDto {
  asDriver: TripSummaryDto[];
  asParticipant: TripSummaryDto[];
  pendingInvitations: (InvitationDto & { trip: TripSummaryDto })[];
  pendingRequests: { tripId: string; count: number }[];
  awaitingClosure: TripSummaryDto[];
  /** Viaggi passati (entro il termine di chiusura) di cui ero membro: per consultarli o inviare segnalazioni. */
  recent: TripSummaryDto[];
}

/** Chi l'utente corrente può segnalare per un viaggio passato (visibile solo a lui). */
export interface AbsenceReportOptionsDto {
  candidates: (UserSummaryDto & { why: 'NO_SHOW' | 'LATE_CANCEL' | 'DRIVER_NO_SHOW' })[];
  /** Utenti già segnalati dall'utente corrente per questo viaggio. */
  alreadyReported: string[];
  /** Fino a quando si può segnalare. */
  deadline: string;
}

// ---------- area amministrativa ----------

/** Viaggio nell'elenco admin: nessun nome né comune, solo dati di servizio (minimizzazione). */
export interface AdminTripDto {
  id: string;
  siteId: string;
  siteName: string;
  date: string;
  arrivalTime: string;
  returnTime: string | null;
  visibility: TripVisibility;
  status: TripStatus;
  seats: number;
  seatsTaken: number;
  /** Solo per i viaggi chiusi. */
  passengersPresent: number | null;
  stopsCount: number;
}

export interface DashboardTotalsDto {
  /** Utenti registrati attivi (con primo accesso completato). */
  registeredUsers: number;
  /** Utenti con un accesso nel periodo. */
  activeUsers: number;
  proposed: { public: number; private: number };
  completed: { public: number; private: number };
  cancelled: number;
  /** Passeggeri presenti / posti offerti nei viaggi completati (0–1). */
  fillRate: number | null;
  passengers: number;
  kmAvoided: number;
  co2SavedKg: number;
  fuelSaved: { unit: string; amount: number }[];
  eurSaved: number;
  /** Viaggi completati con distanze stimate in linea d'aria. */
  estimatedTrips: number;
  /** Viaggi completati senza metriche (coordinate mancanti). */
  incompleteTrips: number;
}

export interface DashboardDto {
  from: string;
  to: string;
  totals: DashboardTotalsDto;
  /** Dettaglio per sede (solo se non è stata scelta una sede). */
  bySite: (DashboardTotalsDto & { siteId: string; siteName: string })[];
}

export interface AdminRoleDto {
  id: string;
  role: Role;
  siteId: string | null;
  siteName: string | null;
  user: UserSummaryDto;
  createdAt: string;
}

export interface AdminUserDto extends UserSummaryDto {
  siteName: string | null;
}

export interface AdminSiteDto extends SiteDto {
  lat: number | null;
  lon: number | null;
  active: boolean;
}

export interface AdminPolicyDto extends PolicyDto {
  acceptances: number;
}

export interface AuditEntryDto {
  id: string;
  at: string;
  action: string;
  actor: UserSummaryDto | null;
  /** UUID dell'autore se l'utente non esiste più (account cancellato). */
  actorId: string | null;
  targetType: string | null;
  targetId: string | null;
  meta: unknown;
}

export interface AuditPageDto {
  entries: AuditEntryDto[];
  /** Cursore per la pagina successiva (id più vecchio), null se finita. */
  nextBefore: string | null;
}

export interface AuditVerifyDto {
  ok: boolean;
  checked: number;
  brokenAtId: string | null;
}

/** Segnalazione vista da un admin. Motivazione e nota solo nel dettaglio (accesso registrato nell'audit log). */
export interface AdminAbsenceReportDto {
  id: string;
  tripId: string | null;
  siteId: string;
  siteName: string;
  tripDate: string;
  status: AbsenceReportStatus;
  reported: UserSummaryDto;
  /** null se chi ha segnalato ha cancellato l'account. */
  reporter: UserSummaryDto | null;
  /** Segnalazioni ricevute dalla stessa persona nel periodo di conservazione (contesto per la decisione). */
  reportedTotal: number;
  createdAt: string;
  handledAt: string | null;
  reason?: string;
  decisionNote?: string | null;
}

export interface StatsPeriodDto {
  asDriver: number;
  asPassenger: number;
  /** Km percorsi insieme ad altri colleghi. */
  sharedKm: number;
  /** Km in auto evitati (passeggero: i propri; conducente: quelli dei suoi passeggeri). */
  kmAvoided: number;
  co2SavedKg: number;
  /** Carburante risparmiato per unità (L, kg, kWh). */
  fuelSaved: { unit: string; amount: number }[];
  eurSaved: number;
}

export interface PersonalStatsDto {
  year: number;
  allTime: StatsPeriodDto;
  thisYear: StatsPeriodDto;
  /** true se alcune distanze sono stimate (linea d'aria) e non calcolate su strada. */
  anyEstimated: boolean;
}

export interface ChatMessageDto {
  id: string;
  tripId: string;
  tripDate: string;
  sender: UserSummaryDto | null;
  kind: ChatMessageKind;
  text: string | null;
  quickCode: string | null;
  createdAt: string;
}
