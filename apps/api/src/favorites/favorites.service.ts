import { Injectable } from '@nestjs/common';
import type { FavoriteDto } from '@fcs/shared';
import { AppException, NotFound } from '../common/errors.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../common/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

/**
 * Colleghi preferiti.
 * - Si può aggiungere solo chi si "conosce" già nell'app: un collega con cui si è
 *   condiviso un viaggio confermato, oppure chi ha scelto di essere trovabile.
 * - Il collega non viene informato e non vede chi lo ha tra i preferiti.
 * - Quando un preferito propone un viaggio PUBBLICO per la mia sede che passa
 *   dal mio comune, ricevo un avviso facoltativo (consenso optionalNotifications).
 */
@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
  ) {}

  async list(userId: string): Promise<FavoriteDto[]> {
    const rows = await this.prisma.favorite.findMany({
      where: { userId, favorite: { status: 'ACTIVE' } },
      include: { favorite: { select: { id: true, firstName: true, lastName: true, site: { select: { name: true } } } } },
      orderBy: [{ favorite: { lastName: 'asc' } }, { favorite: { firstName: 'asc' } }],
    });
    return rows.map((r) => ({
      id: r.favorite.id,
      firstName: r.favorite.firstName,
      lastName: r.favorite.lastName,
      siteName: r.favorite.site?.name ?? null,
    }));
  }

  async add(userId: string, targetId: string): Promise<FavoriteDto[]> {
    if (userId === targetId) throw new AppException('INVALID_FAVORITE', 'Non puoi aggiungere te stesso ai preferiti');
    if (!(await this.canAdd(userId, targetId))) throw NotFound('Collega');
    await this.prisma.favorite.upsert({
      where: { userId_favoriteUserId: { userId, favoriteUserId: targetId } },
      create: { userId, favoriteUserId: targetId },
      update: {},
    });
    return this.list(userId);
  }

  async remove(userId: string, targetId: string): Promise<FavoriteDto[]> {
    await this.prisma.favorite.deleteMany({ where: { userId, favoriteUserId: targetId } });
    return this.list(userId);
  }

  /** Stessa risposta (404) per un collega inesistente o non "conosciuto": non si rivela chi è registrato. */
  private async canAdd(userId: string, targetId: string): Promise<boolean> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { status: true, onboardedAt: true, consent: { select: { discoverable: true } } },
    });
    if (!target || target.status !== 'ACTIVE' || !target.onboardedAt) return false;
    if (target.consent?.discoverable) return true;
    const member = (id: string) => ({
      OR: [{ series: { driverId: id } }, { participants: { some: { userId: id, status: 'ACCEPTED' as const } } }],
    });
    const shared = await this.prisma.trip.count({ where: { AND: [member(userId), member(targetId)], status: { not: 'CANCELLED' } } });
    return shared > 0;
  }

  /**
   * Avvisa (una sola volta per viaggio) chi ha il conducente tra i preferiti, se il
   * viaggio è pubblico, della sua sede e passa dal suo comune.
   */
  async notifyNewTrip(tripId: string): Promise<void> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        siteId: true,
        status: true,
        favoritesNotifiedAt: true,
        visibilityOverride: true,
        series: { select: { driverId: true, visibility: true, stops: { select: { comuneIstat: true } } } },
      },
    });
    if (!trip || trip.favoritesNotifiedAt || trip.status !== 'SCHEDULED') return;
    if ((trip.visibilityOverride ?? trip.series.visibility) !== 'PUBLIC') return;
    // Marcatura atomica: due eventi ravvicinati non producono avvisi doppi.
    const r = await this.prisma.trip.updateMany({
      where: { id: tripId, favoritesNotifiedAt: null },
      data: { favoritesNotifiedAt: this.clock.now() },
    });
    if (r.count === 0) return;
    const fans = await this.prisma.favorite.findMany({
      where: {
        favoriteUserId: trip.series.driverId,
        user: {
          status: 'ACTIVE',
          siteId: trip.siteId,
          comuneIstat: { in: trip.series.stops.map((s) => s.comuneIstat) },
        },
      },
      select: { userId: true },
    });
    if (fans.length) await this.notifications.notify(fans.map((f) => f.userId), 'FAVORITE_NEW_TRIP', tripId);
  }
}
