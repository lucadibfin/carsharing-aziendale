import { Injectable } from '@nestjs/common';
import type { ConsentsInput, MeDto, OnboardingInput, ProfileDto, UpdateConsentsInput, UpdateProfileInput } from '@fcs/shared';
import { AppException, NotFound } from '../common/errors.js';
import { Clock } from '../common/clock.js';
import { CryptoService } from '../common/crypto.service.js';
import { PrismaService, type Tx } from '../common/prisma.service.js';
import { PoliciesService } from '../policies/policies.service.js';
import { EmailVerificationService } from './email-verification.service.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly policies: PoliciesService,
    private readonly clock: Clock,
    private readonly email: EmailVerificationService,
  ) {}

  async me(userId: string): Promise<MeDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { roles: true } });
    if (!user) throw NotFound('Utente');
    const pending = await this.policies.pendingFor(userId);
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      siteId: user.siteId,
      comuneIstat: user.comuneIstat,
      roles: user.roles.map((r) => ({ role: r.role, siteId: r.siteId })),
      onboardingRequired: !user.onboardedAt || !user.emailVerifiedAt || pending.length > 0,
      pendingPolicyIds: pending,
      emailVerified: Boolean(user.emailVerifiedAt),
    };
  }

  async profile(userId: string): Promise<ProfileDto> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, include: { consent: true } });
    if (!u) throw NotFound('Utente');
    return {
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      siteId: u.siteId,
      comuneIstat: u.comuneIstat,
      phone: this.crypto.decryptNullable(u.phoneEnc),
      fuelType: u.fuelType,
      consumptionPer100km: u.consumptionPer100km,
      consents: {
        phoneVisible: u.consent?.phoneVisible ?? false,
        discoverable: u.consent?.discoverable ?? false,
        emailNotifications: u.consent?.emailNotifications ?? false,
      },
      email: await this.email.status(userId),
    };
  }

  /**
   * Primo avvio: presa visione dell'informativa, accettazione dei termini,
   * consensi facoltativi (separati) e profilo minimo, in un'unica transazione.
   * L'email deve essere già stata verificata (POST /profile/email/code + /confirm).
   */
  async completeOnboarding(userId: string, input: OnboardingInput): Promise<MeDto> {
    const current = await this.policies.current();
    const required = current.map((d) => d.id);
    if (!required.every((id) => input.acceptedPolicyIds.includes(id))) {
      throw new AppException('POLICIES_REQUIRED', 'È necessario prendere visione dell’informativa e accettare i termini d’uso');
    }
    await this.assertSiteAndComune(input.siteId, input.comuneIstat);
    const { emailVerifiedAt } = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerifiedAt: true } });
    if (!emailVerifiedAt) {
      throw new AppException('EMAIL_NOT_VERIFIED', 'Conferma prima il tuo indirizzo email con il codice ricevuto');
    }
    await this.policies.accept(userId, input.acceptedPolicyIds);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { siteId: input.siteId, comuneIstat: input.comuneIstat, onboardedAt: this.clock.now() },
      });
      await this.writeConsents(tx, userId, input.consents);
    });
    return this.me(userId);
  }

  async acceptPolicies(userId: string, policyIds: string[]): Promise<MeDto> {
    await this.policies.accept(userId, policyIds);
    return this.me(userId);
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<ProfileDto> {
    if (input.siteId || input.comuneIstat) {
      const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
      await this.assertSiteAndComune(input.siteId ?? u.siteId!, input.comuneIstat ?? u.comuneIstat!);
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        siteId: input.siteId,
        comuneIstat: input.comuneIstat,
        phoneEnc: input.phone === undefined ? undefined : this.crypto.encryptNullable(input.phone),
        fuelType: input.fuelType,
        consumptionPer100km: input.consumptionPer100km,
      },
    });
    return this.profile(userId);
  }

  async updateConsents(userId: string, input: UpdateConsentsInput): Promise<ProfileDto> {
    await this.prisma.$transaction((tx) => this.writeConsents(tx, userId, input));
    return this.profile(userId);
  }

  /** Aggiorna i consensi e ne registra lo storico (solo quelli effettivamente cambiati). */
  private async writeConsents(tx: Tx, userId: string, input: Partial<ConsentsInput>): Promise<void> {
    const before = await tx.userConsent.upsert({ where: { userId }, create: { userId }, update: {} });
    const changed = (Object.keys(input) as (keyof ConsentsInput)[]).filter(
      (k) => input[k] !== undefined && input[k] !== before[k],
    );
    if (changed.length === 0) return;
    await tx.userConsent.update({ where: { userId }, data: input });
    await tx.consentEvent.createMany({
      data: changed.map((k) => ({ userId, consent: k, granted: Boolean(input[k]) })),
    });
  }

  private async assertSiteAndComune(siteId: string, comuneIstat: string): Promise<void> {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, active: true } });
    if (!site) throw new AppException('INVALID_SITE', 'Sede non valida');
    const comune = await this.prisma.comune.findFirst({ where: { istat: comuneIstat, active: true } });
    if (!comune) throw new AppException('INVALID_COMUNE', 'Comune non valido');
  }
}
