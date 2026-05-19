import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import { AdminAuthController } from './admin-auth.controller';
import { AdminPanelJwtStrategy } from './strategies/admin-panel-jwt.strategy';
import { UsersModule } from '../users/users.module';
import { CantonModule } from '../canton/canton.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({}),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: '8h' },
      }),
    }),
    UsersModule,
    CantonModule,
    PrismaModule,
  ],
  controllers: [AdminAuthController, AdminController],
  providers: [AdminService, AdminGuard, AdminPanelJwtStrategy],
})
export class AdminModule {}
