import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { CantonLedgerService } from './canton/canton-ledger.service';
import { SpliceValidatorService } from './canton/splice-validator.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const map: Record<string, string> = {
                BALANCE_READ_FROM_DB: 'true',
                BALANCE_DB_MAX_AGE_MS: '60000',
                BALANCE_BACKGROUND_DEBOUNCE_MS: '15000',
                CC_INBOUND_SYNC_POLL_MS: '30000',
              };
              return map[key];
            },
          },
        },
        {
          provide: SpliceValidatorService,
          useValue: { isReachable: async () => true, isConfigured: true },
        },
        {
          provide: CantonLedgerService,
          useValue: { isReachable: async () => true },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('returns health payload', () => {
    expect(appController.ok().ok).toBe(true);
  });

  it('returns canton health payload', async () => {
    const result = await appController.canton();
    expect(result.ok).toBe(true);
    expect(result.balance.readFromDb).toBe(true);
  });
});
