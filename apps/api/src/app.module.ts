import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'path';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { CantonModule } from './canton/canton.module';
import { PartyModule } from './party/party.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuestsModule } from './quests/quests.module';
import { AdminModule } from './admin/admin.module';

/** Load API env from `apps/api/.env` even when npm workspaces run Nest with cwd at repo root. */
const resolveApiEnvPaths = (): string[] => [
  resolve(process.cwd(), 'apps', 'api', '.env'),
  resolve(process.cwd(), '.env'),
  resolve(__dirname, '..', '..', '.env'),
];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolveApiEnvPaths(),
    }),    PrismaModule,
    AuthModule,
    CantonModule,
    PartyModule,
    QuestsModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
