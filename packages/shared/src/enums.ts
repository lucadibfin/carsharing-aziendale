// Enum condivisi tra frontend e backend. I valori coincidono con gli enum Prisma.

export const Role = {
  SITE_ADMIN: 'SITE_ADMIN',
  GLOBAL_ADMIN: 'GLOBAL_ADMIN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  DEACTIVATED: 'DEACTIVATED',
  PENDING_DELETION: 'PENDING_DELETION',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const TripVisibility = {
  PUBLIC: 'PUBLIC',
  PRIVATE: 'PRIVATE',
} as const;
export type TripVisibility = (typeof TripVisibility)[keyof typeof TripVisibility];

export const TripStatus = {
  SCHEDULED: 'SCHEDULED',
  AWAITING_CLOSURE: 'AWAITING_CLOSURE',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;
export type TripStatus = (typeof TripStatus)[keyof typeof TripStatus];

export const ParticipantStatus = {
  REQUESTED: 'REQUESTED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  WAITLISTED: 'WAITLISTED',
  NOT_THERE: 'NOT_THERE',
} as const;
export type ParticipantStatus = (typeof ParticipantStatus)[keyof typeof ParticipantStatus];

export const InvitationStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
} as const;
export type InvitationStatus = (typeof InvitationStatus)[keyof typeof InvitationStatus];

export const InvitationScope = {
  TRIP: 'TRIP',
  SERIES: 'SERIES',
} as const;
export type InvitationScope = (typeof InvitationScope)[keyof typeof InvitationScope];

export const FuelType = {
  PETROL: 'PETROL',
  DIESEL: 'DIESEL',
  LPG: 'LPG',
  METHANE: 'METHANE',
  HYBRID: 'HYBRID',
  ELECTRIC: 'ELECTRIC',
} as const;
export type FuelType = (typeof FuelType)[keyof typeof FuelType];

export const FUEL_TYPE_LABELS: Record<FuelType, string> = {
  PETROL: 'Benzina',
  DIESEL: 'Gasolio',
  LPG: 'GPL',
  METHANE: 'Metano',
  HYBRID: 'Ibrida',
  ELECTRIC: 'Elettrica',
};

export const ChatMessageKind = {
  TEXT: 'TEXT',
  QUICK: 'QUICK',
  SYSTEM: 'SYSTEM',
} as const;
export type ChatMessageKind = (typeof ChatMessageKind)[keyof typeof ChatMessageKind];

export const AbsenceReportStatus = {
  OPEN: 'OPEN',
  DISMISSED: 'DISMISSED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
} as const;
export type AbsenceReportStatus = (typeof AbsenceReportStatus)[keyof typeof AbsenceReportStatus];

export const ABSENCE_REPORT_STATUS_LABELS: Record<AbsenceReportStatus, string> = {
  OPEN: 'Da esaminare',
  DISMISSED: 'Archiviata',
  ACKNOWLEDGED: 'Presa in carico',
};

export const PolicyType = {
  PRIVACY_NOTICE: 'PRIVACY_NOTICE',
  TERMS: 'TERMS',
} as const;
export type PolicyType = (typeof PolicyType)[keyof typeof PolicyType];
