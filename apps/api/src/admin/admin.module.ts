import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AdminController } from './admin.controller';
import { AdminUploadsController } from './admin-uploads.controller';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import { AdminAuthController } from './admin-auth.controller';
import { AdminPanelJwtStrategy } from './strategies/admin-panel-jwt.strategy';
import { UsersModule } from '../users/users.module';
import { CantonModule } from '../canton/canton.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { QuestLedgerService } from '../canton/quest-ledger.service';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({}),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // SECURITY (H1): Admin panel MUST use a distinct signing secret from user
        // JWTs. Sharing JWT_ACCESS_SECRET means a single secret leak lets an
        // attacker forge admin tokens ({ sub:'admin-panel', scope:'admin-panel' })
        // and gain full reward-distribution power. The AdminPanelJwtStrategy
        // reads the same ADMIN_JWT_SECRET for verification.
        const adminSecret = config.getOrThrow<string>('ADMIN_JWT_SECRET');
        const userSecret = config.get<string>('JWT_ACCESS_SECRET') ?? '';
        if (adminSecret === userSecret) {
          throw new Error(
            'ADMIN_JWT_SECRET must differ from JWT_ACCESS_SECRET — ' +
              'a shared secret defeats key separation. Generate a unique ' +
              'ADMIN_JWT_SECRET (node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))").',
          );
        }
        return {
          secret: adminSecret,
          signOptions: { expiresIn: '8h' },
        };
      },
    }),
    UsersModule,
    CantonModule,
    PrismaModule,
    QueueModule,
  ],
  controllers: [AdminAuthController, AdminController, AdminUploadsController],
  providers: [
    AdminService,
    AdminGuard,
    AdminPanelJwtStrategy,
    QuestLedgerService,
  ],
})
export class AdminModule {}
