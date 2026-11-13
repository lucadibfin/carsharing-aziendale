import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  ApiError,
  ChatMessageDto,
  ComuneDto,
  ConsentsInput,
  CreateTripInput,
  EmailStatusDto,
  FavoriteDto,
  InvitationDto,
  InviteLinkDto,
  MeDto,
  MyTripsDto,
  OnboardingInput,
  PersonalStatsDto,
  PolicyDto,
  ProfileDto,
  PushSubscriptionInput,
  SearchTripsInput,
  SiteDto,
  TripDetailDto,
  TripSummaryDto,
  TripVisibility,
  UpdateProfileInput,
  UserSummaryDto,
} from '@fcs/shared';

/** Client tipizzato dell'API (stessa origine: niente CORS, cookie di sessione e XSRF automatici). */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api';

  private get<T>(url: string, params?: Record<string, string | undefined>): Promise<T> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v) p = p.set(k, v);
    return firstValueFrom(this.http.get<T>(this.base + url, { params: p }));
  }
  private post<T>(url: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(this.base + url, body));
  }
  private patch<T>(url: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.patch<T>(this.base + url, body));
  }
  private put<T>(url: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.put<T>(this.base + url, body));
  }
  private delete<T>(url: string, body?: unknown): Promise<T> {
    return firstValueFrom(this.http.delete<T>(this.base + url, { body }));
  }

  // auth e profilo
  me = () => this.get<MeDto>('/me');
  login = (username: string, password: string) => this.post<void>('/auth/login', { username, password });
  logout = () => this.post<void>('/auth/logout');
  policies = () => this.get<PolicyDto[]>('/policies/current');
  acceptPolicies = (policyIds: string[]) => this.post<MeDto>('/policies/accept', { policyIds });
  onboarding = (input: OnboardingInput) => this.post<MeDto>('/onboarding', input);
  profile = () => this.get<ProfileDto>('/profile');
  updateProfile = (input: UpdateProfileInput) => this.patch<ProfileDto>('/profile', input);
  updateConsents = (input: Partial<ConsentsInput>) => this.patch<ProfileDto>('/profile/consents', input);
  emailStatus = () => this.get<EmailStatusDto>('/profile/email');
  requestEmailCode = (email: string) => this.post<EmailStatusDto>('/profile/email/code', { email });
  confirmEmail = (code: string) => this.post<EmailStatusDto>('/profile/email/confirm', { code });
  cancelPendingEmail = () => this.delete<EmailStatusDto>('/profile/email/pending');

  // riferimenti
  sites = () => this.get<SiteDto[]>('/sites');
  comuni = (q: string) => this.get<ComuneDto[]>('/comuni', { q });
  comune = (istat: string) => this.get<ComuneDto>(`/comuni/${istat}`);

  // viaggi
  createTrip = (input: CreateTripInput) => this.post<TripDetailDto>('/trips', input);
  searchTrips = (q: SearchTripsInput) => this.get<TripSummaryDto[]>('/trips/search', { ...q });
  myTrips = () => this.get<MyTripsDto>('/trips/mine');
  trip = (id: string) => this.get<TripDetailDto>(`/trips/${id}`);
  setVisibility = (id: string, visibility: TripVisibility) => this.patch<TripDetailDto>(`/trips/${id}/visibility`, { visibility });
  cancelTrip = (id: string) => this.post<void>(`/trips/${id}/cancel`);
  requestJoin = (id: string, boardingComune: string) => this.post<TripDetailDto>(`/trips/${id}/requests`, { boardingComune });
  acceptRequest = (id: string, pid: string) => this.post<TripDetailDto>(`/trips/${id}/participants/${pid}/accept`);
  rejectRequest = (id: string, pid: string) => this.post<TripDetailDto>(`/trips/${id}/participants/${pid}/reject`);
  removeParticipant = (id: string, pid: string) => this.post<TripDetailDto>(`/trips/${id}/participants/${pid}/remove`);
  leaveTrip = (id: string) => this.post<{ lateCancel: boolean }>(`/trips/${id}/leave`);
  closeTrip = (id: string, presentParticipantIds: string[]) =>
    this.post<TripDetailDto>(`/trips/${id}/close`, { presentParticipantIds });

  // inviti
  searchColleagues = (q: string) => this.get<(UserSummaryDto & { siteName: string | null })[]>('/users/search', { q });
  inviteUser = (tripId: string, userId: string) => this.post<InvitationDto>(`/trips/${tripId}/invitations`, { userId });
  createInviteLink = (tripId: string, expiresInHours: number) =>
    this.post<InviteLinkDto>(`/trips/${tripId}/invitation-links`, { expiresInHours });
  revokeInvitation = (id: string) => this.delete<void>(`/invitations/${id}`);
  acceptInvitation = (id: string, boardingComune: string) => this.post<TripDetailDto>(`/invitations/${id}/accept`, { boardingComune });
  declineInvitation = (id: string) => this.post<void>(`/invitations/${id}/decline`);
  previewInviteLink = (token: string) => this.post<TripSummaryDto>('/invitation-links/preview', { token });
  acceptInviteLink = (token: string, boardingComune: string) =>
    this.post<TripDetailDto>('/invitation-links/accept', { token, boardingComune });

  // chat
  chat = (tripId: string) => this.get<{ seriesId: string; muted: boolean; messages: ChatMessageDto[] }>(`/trips/${tripId}/chat`);
  sendChat = (tripId: string, body: { text?: string; quickCode?: string }) =>
    this.post<ChatMessageDto>(`/trips/${tripId}/chat/messages`, body);
  muteChat = (tripId: string, muted: boolean) => this.put<void>(`/trips/${tripId}/chat/mute`, { muted });

  // preferiti
  favorites = () => this.get<FavoriteDto[]>('/favorites');
  addFavorite = (userId: string) => this.put<FavoriteDto[]>(`/favorites/${userId}`, {});
  removeFavorite = (userId: string) => this.delete<FavoriteDto[]>(`/favorites/${userId}`);

  // statistiche
  myStats = () => this.get<PersonalStatsDto>('/stats/me');

  // push
  pushKey = () => this.get<{ publicKey: string; enabled: boolean }>('/push/public-key');
  pushSubscribe = (sub: PushSubscriptionInput) => this.post<void>('/push/subscriptions', sub);
  pushUnsubscribe = (endpoint: string) => this.delete<void>('/push/subscriptions', { endpoint });
}

/** Estrae il messaggio d'errore (in italiano) restituito dall'API. */
export function errorMessage(e: unknown, fallback = 'Si è verificato un errore. Riprova.'): string {
  if (e instanceof HttpErrorResponse) {
    const body = e.error as Partial<ApiError> | null;
    if (e.status === 0) return 'Connessione assente. Controlla la rete e riprova.';
    if (body?.errors?.length) return body.errors.map((x) => x.message).join('. ');
    if (body?.message) return body.message;
  }
  return fallback;
}

export function errorCode(e: unknown): string | undefined {
  return e instanceof HttpErrorResponse ? (e.error as Partial<ApiError> | null)?.code : undefined;
}
