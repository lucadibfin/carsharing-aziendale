// Forme delle risposte dell'API (contratto tra backend e frontend).
import type {
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

export interface TripStopDto {
  order: number;
  comuneIstat: string;
  comuneName: string;
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
}

export interface TripDetailDto extends TripSummaryDto {
  notes: string | null;
  driverPhone?: string | null;
  participants: TripParticipantDto[];
  invitations?: InvitationDto[];
  /** Invito personale in sospeso dell'utente corrente, se presente. */
  myInvitationId?: string;
  canCancelWithoutPenalty: boolean;
  cancellationDeadline: string;
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
