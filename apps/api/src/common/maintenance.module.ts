import { Global, Module } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';

/**
 * Modul global untuk mode maintenance.
 *
 * `@Global()` supaya MaintenanceService bisa di-inject di mana saja
 * (AdminController, PublicController, guard) tanpa import eksplisit per modul.
 * PrismaService sudah tersedia global via PrismaModule.
 */
@Global()
@Module({
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
