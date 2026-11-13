import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import {
  acceptPoliciesSchema,
  type AcceptPoliciesInput,
  onboardingSchema,
  type OnboardingInput,
  updateConsentsSchema,
  type UpdateConsentsInput,
  updateProfileSchema,
  type UpdateProfileInput,
} from '@fcs/shared';
import { AllowDuringOnboarding, CurrentUser, Public } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session.service.js';
import { PoliciesService } from '../policies/policies.service.js';
import { UsersService } from './users.service.js';

@Controller()
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly policies: PoliciesService,
  ) {}

  @AllowDuringOnboarding()
  @Get('me')
  me(@CurrentUser() u: SessionUser) {
    return this.users.me(u.userId);
  }

  /** Pubblico: l'informativa deve essere consultabile anche prima del login (art. 13). */
  @Public()
  @Get('policies/current')
  async currentPolicies() {
    return (await this.policies.current()).map((d) => this.policies.toDto(d));
  }

  @AllowDuringOnboarding()
  @Post('onboarding')
  onboarding(@CurrentUser() u: SessionUser, @Body({ schema: onboardingSchema }) body: OnboardingInput) {
    return this.users.completeOnboarding(u.userId, body);
  }

  /** Nuova presa visione dopo un aggiornamento di informativa o termini. */
  @AllowDuringOnboarding()
  @Post('policies/accept')
  acceptPolicies(@CurrentUser() u: SessionUser, @Body({ schema: acceptPoliciesSchema }) body: AcceptPoliciesInput) {
    return this.users.acceptPolicies(u.userId, body.policyIds);
  }

  @Get('profile')
  profile(@CurrentUser() u: SessionUser) {
    return this.users.profile(u.userId);
  }

  @Patch('profile')
  updateProfile(@CurrentUser() u: SessionUser, @Body({ schema: updateProfileSchema }) body: UpdateProfileInput) {
    return this.users.updateProfile(u.userId, body);
  }

  @Patch('profile/consents')
  updateConsents(@CurrentUser() u: SessionUser, @Body({ schema: updateConsentsSchema }) body: UpdateConsentsInput) {
    return this.users.updateConsents(u.userId, body);
  }
}
