import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { loginSchema, type LoginInput } from '@fcs/shared';
import { AuthService } from './auth.service.js';
import { AllowDuringOnboarding, CurrentUser, Public } from './decorators.js';
import { SessionService, type SessionUser } from './session.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(204)
  async login(
    @Body({ schema: loginSchema }) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    try {
      const { token, expiresAt } = await this.auth.login(body, req.ip ?? 'unknown');
      this.sessions.setCookie(res, token, expiresAt);
    } finally {
      // Riferimenti alla password rimossi appena possibile, in ogni caso.
      // (Le stringhe JS sono immutabili: la memoria sarà liberata dal GC.)
      (body as Partial<LoginInput>).password = undefined;
      if (req.body && typeof req.body === 'object') (req.body as Record<string, unknown>)['password'] = undefined;
    }
  }

  @AllowDuringOnboarding()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: SessionUser, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(user.sessionId);
    this.sessions.clearCookie(res);
  }
}
