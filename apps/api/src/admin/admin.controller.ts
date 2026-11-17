import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  adminReportsQuerySchema,
  type AdminReportsQuery,
  adminTripsQuerySchema,
  type AdminTripsQuery,
  adminUserSearchSchema,
  auditQuerySchema,
  type AuditQuery,
  dashboardQuerySchema,
  type DashboardQuery,
  decideAbsenceReportSchema,
  type DecideAbsenceReportInput,
  grantRoleSchema,
  type GrantRoleInput,
  id,
  publishPolicySchema,
  type PublishPolicyInput,
  type Settings,
  settingsSchema,
  siteInputSchema,
  type SiteInput,
  updateSiteSchema,
  type UpdateSiteInput,
} from '@fcs/shared';
import { CurrentUser } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session.service.js';
import { AbsenceReportsService } from '../trips/absence-reports.service.js';
import { AdminConfigService } from './admin-config.service.js';
import { AdminTripsService } from './admin-trips.service.js';
import { AdminGuard, AdminScope, GlobalAdminOnly, type SiteScope } from './admin.guard.js';

/** Area amministrativa. Admin di sede: solo la propria sede; admin globale: tutto. */
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly trips: AdminTripsService,
    private readonly config: AdminConfigService,
    private readonly reports: AbsenceReportsService,
  ) {}

  // ---------- admin di sede e globali ----------

  @Get('dashboard')
  dashboard(@CurrentUser() u: SessionUser, @AdminScope() scope: SiteScope, @Query({ schema: dashboardQuerySchema }) q: DashboardQuery) {
    return this.trips.dashboard(u.userId, scope, q);
  }

  @Get('trips')
  tripList(@CurrentUser() u: SessionUser, @AdminScope() scope: SiteScope, @Query({ schema: adminTripsQuerySchema }) q: AdminTripsQuery) {
    return this.trips.trips(u.userId, scope, q);
  }

  @Get('reports')
  reportList(@CurrentUser() u: SessionUser, @AdminScope() scope: SiteScope, @Query({ schema: adminReportsQuerySchema }) q: AdminReportsQuery) {
    return this.reports.adminList(u.userId, scope, q);
  }

  @Get('reports/:id')
  report(@CurrentUser() u: SessionUser, @AdminScope() scope: SiteScope, @Param('id', { schema: id }) reportId: string) {
    return this.reports.adminGet(u.userId, scope, reportId);
  }

  @Post('reports/:id/decision')
  @HttpCode(200)
  decide(
    @CurrentUser() u: SessionUser,
    @AdminScope() scope: SiteScope,
    @Param('id', { schema: id }) reportId: string,
    @Body({ schema: decideAbsenceReportSchema }) body: DecideAbsenceReportInput,
  ) {
    return this.reports.adminDecide(u.userId, scope, reportId, body);
  }

  // ---------- solo admin globali ----------

  @GlobalAdminOnly()
  @Get('settings')
  settings() {
    return this.config.getSettings();
  }

  @GlobalAdminOnly()
  @Put('settings')
  updateSettings(@CurrentUser() u: SessionUser, @Body({ schema: settingsSchema }) body: Settings) {
    return this.config.updateSettings(u.userId, body);
  }

  @GlobalAdminOnly()
  @Get('roles')
  roles() {
    return this.config.roles();
  }

  @GlobalAdminOnly()
  @Post('roles')
  grant(@CurrentUser() u: SessionUser, @Body({ schema: grantRoleSchema }) body: GrantRoleInput) {
    return this.config.grantRole(u.userId, body);
  }

  @GlobalAdminOnly()
  @Delete('roles/:id')
  revoke(@CurrentUser() u: SessionUser, @Param('id', { schema: id }) roleId: string) {
    return this.config.revokeRole(u.userId, roleId);
  }

  @GlobalAdminOnly()
  @Get('users/search')
  searchUsers(@CurrentUser() u: SessionUser, @Query({ schema: adminUserSearchSchema }) q: { q: string }) {
    return this.config.searchUsers(u.userId, q.q);
  }

  @GlobalAdminOnly()
  @Get('sites')
  sites() {
    return this.config.sites();
  }

  @GlobalAdminOnly()
  @Post('sites')
  createSite(@CurrentUser() u: SessionUser, @Body({ schema: siteInputSchema }) body: SiteInput) {
    return this.config.createSite(u.userId, body);
  }

  @GlobalAdminOnly()
  @Patch('sites/:id')
  updateSite(@CurrentUser() u: SessionUser, @Param('id', { schema: id }) siteId: string, @Body({ schema: updateSiteSchema }) body: UpdateSiteInput) {
    return this.config.updateSite(u.userId, siteId, body);
  }

  @GlobalAdminOnly()
  @Get('policies')
  policies() {
    return this.config.policyVersions();
  }

  @GlobalAdminOnly()
  @Post('policies')
  publishPolicy(@CurrentUser() u: SessionUser, @Body({ schema: publishPolicySchema }) body: PublishPolicyInput) {
    return this.config.publishPolicy(u.userId, body);
  }

  @GlobalAdminOnly()
  @Get('audit')
  audit(@CurrentUser() u: SessionUser, @Query({ schema: auditQuerySchema }) q: AuditQuery) {
    return this.config.auditPage(u.userId, q);
  }

  @GlobalAdminOnly()
  @Post('audit/verify')
  @HttpCode(200)
  verifyAudit(@CurrentUser() u: SessionUser) {
    return this.config.verifyAudit(u.userId);
  }
}
