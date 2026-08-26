/** TransferPreapproval status — endpoint publik-auth utk user external. */
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import {
  Controller,
  Get,
  Logger,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { UsersService } from '../users/users.service';
import type { AuthedReq } from './party-shared';

/**
 * M5: seluruh jalur custodial (ensure/enable/disable via ledger custodial)
 * dihapus — semua wallet CanQuest kini non-custodial. Toggle external ada di
 * SigningRelayController (/party/sign/preapproval/*). Controller ini hanya
 * menyediakan status baca.
 */
@Controller('party')
@UseGuards(AuthGuard('jwt'))
export class PartyPreapprovalController {
  private readonly logger = new Logger(PartyPreapprovalController.name);

  constructor(
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  @SkipThrottle()
  @Get('preapproval-status')
  async preapprovalStatus(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId) {
      return {
        hasWallet: false,
        active: false,
        preapproval: { active: false },
        message:
          'No wallet found. Create your wallet first from the Wallet page.',
      };
    }

    // External (satu-satunya jenis wallet): cek via validator API —
    // ExternalPartySetupProposal membuat TransferPreapproval yang tidak
    // terlihat lewat lookup custodial lama.
    if (user.walletKind === 'external') {
      try {
        const valUrl = (this.config.get<string>('CANTON_VALIDATOR_URL') ?? '').replace(/\/$/, '');
        const keycloakUrl = this.config.get<string>('KEYCLOAK_URL');
        const realm = this.config.get<string>('KEYCLOAK_REALM');
        const tokenRes = await fetch(
          `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=client_credentials&client_id=${this.config.get('LEDGER_CLIENT_ID')}&client_secret=${this.config.get('LEDGER_CLIENT_SECRET')}&scope=daml_ledger_api`,
          },
        );
        const { access_token: token } = await tokenRes.json();
        const checkRes = await fetch(
          `${valUrl}/api/validator/v0/admin/transfer-preapprovals/by-party/${encodeURIComponent(user.cantonPartyId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (checkRes.ok) {
          const data = await checkRes.json();
          const active = Boolean(
            data?.transfer_preapproval || data?.transfer_preapproval_contract_id || data?.active,
          );
          return { hasWallet: true, active, preapproval: { active }, partyId: user.cantonPartyId };
        }
        // 404 = no preapproval
        return {
          hasWallet: true,
          active: false,
          preapproval: { active: false },
          partyId: user.cantonPartyId,
        };
      } catch {
        // Validator API check failed — default inactive (safe)
        return {
          hasWallet: true,
          active: false,
          preapproval: { active: false },
          partyId: user.cantonPartyId,
        };
      }
    }

    // Fallback: jenis wallet tak dikenal tanpa jalur custodial → inactive.
    return {
      hasWallet: true,
      active: false,
      preapproval: { active: false },
      partyId: user.cantonPartyId,
    };
  }
}
