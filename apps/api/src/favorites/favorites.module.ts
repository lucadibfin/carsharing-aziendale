import { Controller, Delete, Get, Module, Param, Put } from '@nestjs/common';
import { id } from '@fcs/shared';
import { CurrentUser } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { FavoritesService } from './favorites.service.js';

@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  list(@CurrentUser() u: SessionUser) {
    return this.favorites.list(u.userId);
  }

  @Put(':userId')
  add(@CurrentUser() u: SessionUser, @Param('userId', { schema: id }) target: string) {
    return this.favorites.add(u.userId, target);
  }

  @Delete(':userId')
  remove(@CurrentUser() u: SessionUser, @Param('userId', { schema: id }) target: string) {
    return this.favorites.remove(u.userId, target);
  }
}

@Module({
  imports: [NotificationsModule],
  controllers: [FavoritesController],
  providers: [FavoritesService],
  exports: [FavoritesService],
})
export class FavoritesModule {}
