import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { KeycloakAdminService } from '../auth/keycloak-admin.service';
import { SpliceValidatorService } from './splice-validator.service';
import { CantonLedgerService } from './canton-ledger.service';

/**
 * Orkestrator onboarding wallet Model A — satu user, satu Keycloak identity, satu party.
 *
 * Flow (7 langkah target, backend menjalankan langkah 1-5):
 *   a. Buat user Keycloak → dapat UUID (sub)
 *   b. Onboard di Splice validator → dapat party_id
 *   c. Bridge UUID ke Ledger API user (POST/PATCH /v2/users/{UUID})
 *   d. Grant CanActAs + CanReadAs di Ledger API
 *
 * Tidak menyimpan ke database — hanya mengembalikan { keycloakId, partyId }.
 * Penyimpanan ke tabel User dilakukan oleh pemanggil (controller) di Fase 5.
 */
@Injectable()
export class WalletOnboardingService {
  private readonly logger = new Logger(WalletOnboardingService.name);

  constructor(
    private readonly keycloakAdmin: KeycloakAdminService,
    private readonly spliceValidator: SpliceValidatorService,
    private readonly cantonLedger: CantonLedgerService,
  ) {}

  /**
   * Onboard wallet lengkap untuk satu user.
   * Return { keycloakId, partyId } — pemanggil menyimpan ke tabel User.
   */
  async onboardWalletForUser(input: {
    username: string;
    email: string;
    firstName?: string;
    lastName?: string;
  }): Promise<{ keycloakId: string; partyId: string }> {
    // a. Password acak — penanganan password user sesungguhnya di Fase 5
    const password = randomBytes(24).toString('hex');

    this.logger.log(
      `onboardWallet start: @${input.username} (${input.email})`,
    );

    // b. Buat / dapatkan user Keycloak
    const keycloakId = await this.keycloakAdmin.createUserAndGetId({
      username: input.username,
      email: input.email,
      firstName: input.firstName ?? input.username,
      lastName: input.lastName ?? 'canquest',
      password,
    });
    this.logger.log(
      `onboardWallet keycloak: ${input.username} → ${keycloakId.slice(0, 8)}...`,
    );

    // c. Onboard di Splice validator → party_id
    const partyId = await this.spliceValidator.createWalletUser(
      input.username,
    );
    if (!partyId) {
      throw new Error(
        `Splice createWalletUser gagal untuk @${input.username} — ` +
        'pastikan validator reachable dan username belum dipakai',
      );
    }
    this.logger.log(
      `onboardWallet party: @${input.username} → ${partyId.split('::')[0]}`,
    );

    // d. Bridge UUID ke Ledger API user (idempoten)
    await this.cantonLedger.ensureLedgerUser(keycloakId, partyId);

    // e. Grant operator read rights supaya ACS query offers bisa baca party user
    await this.cantonLedger.grantUserRights(partyId).catch((err) => {
      this.logger.warn(`grantUserRights untuk operator gagal (non-fatal): ${String(err)}`);
    });

    // f. Grant admin service account CanReadAs rights untuk query ACS offers
    await this.cantonLedger.grantAdminReadRights(partyId).catch((err) => {
      this.logger.warn(`grantAdminReadRights gagal (non-fatal): ${String(err)}`);
    });

    this.logger.log(
      `onboardWallet done: @${input.username} keycloak=${keycloakId.slice(0, 8)}... party=${partyId.split('::')[0]}`,
    );

    return { keycloakId, partyId };
  }
}