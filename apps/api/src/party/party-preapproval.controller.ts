/**
 * TransferPreapproval: status, ensure, enable/disable.
 *
 * Diekstraksi dari party.controller.ts — route path & behavior identik.
 */
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CantonLedgerService } from '../canton/canton-ledger.service';
import { FeaturedAppActivityService } from '../canton/featured-app-activity.service';
import { SkipThrottle } from '@nestjs/throttler';
import { SpliceValidatorService } from '../canton/splice-validator.service';
import { UsersService } from '../users/users.service';
import { hasRealWallet } from '../common/wallet-policy';
import {
  normalizeWalletUsername,
  spliceWalletUsernameFromParty,
} from '../common/canton-party-id';
import type { AuthedReq } from './party-shared';

/** TransferPreapproval: status, ensure, enable/disable. Prefix & guard sama dengan controller party lama. */
@Controller('party')
@UseGuards(AuthGuard('jwt'))
export class PartyPreapprovalController {
  private readonly logger = new Logger(PartyPreapprovalController.name);

  constructor(
    private readonly users: UsersService,
    private readonly ledger: CantonLedgerService,
    private readonly splice: SpliceValidatorService,
    private readonly featuredActivity: FeaturedAppActivityService,
    private readonly config: ConfigService,
  ) {}

  /** Cooldown toggle preapproval: 1× per 7 hari (tiap re-enable burn ~1.5 CC). */
  private static readonly PREAPPROVAL_TOGGLE_COOLDOWN_MS =
    7 * 24 * 60 * 60 * 1000;

  /** Lempar 400 jika masih dalam cooldown 7 hari sejak toggle terakhir. */
  private assertPreapprovalToggleCooldown(
    toggledAt: Date | null | undefined,
  ): void {
    if (!toggledAt) return;

    const elapsed = Date.now() - new Date(toggledAt).getTime();
    const remaining =
      PartyPreapprovalController.PREAPPROVAL_TOGGLE_COOLDOWN_MS - elapsed;

    if (remaining > 0) {
      const days = Math.ceil(remaining / (24 * 60 * 60 * 1000));

      // Format tanggal menjadi format yang mudah dibaca, misal: "June 27, 2026"
      const nextDate = new Date(Date.now() + remaining);
      const nextAtFormatted = nextDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

      throw new BadRequestException(
        `Preapproval settings are limited to once per week. ` +
          `Please try again in ~${days} day(s) (after ${nextAtFormatted}).`,
      );
    }
  }

  @Post('ensure-preapproval')
  async ensurePreapproval(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId) {
      throw new BadRequestException(
        'Create your wallet first from the Wallet page.',
      );
    }
    if (user.cantonPartyId.startsWith('canquest:')) {
      throw new BadRequestException(
        'Party ID is still a placeholder. Run POST /party/allocate when the Splice tunnel is active.',
      );
    }

    const preferredUsername =
      spliceWalletUsernameFromParty(user.cantonPartyId) ??
      normalizeWalletUsername(user.username);
    if (!preferredUsername) {
      throw new BadRequestException(
        'Could not resolve Splice wallet username for this party.',
      );
    }

    let walletUsername =
      (await this.splice.resolveWalletUsernameForParty(user.cantonPartyId)) ??
      preferredUsername;

    if (!(await this.splice.canAccessWalletAs(walletUsername))) {
      const onboard = await this.splice.ensureSpliceWalletUser(
        preferredUsername,
        user.cantonPartyId,
      );
      if (!onboard.ok) {
        this.logger.warn(
          `ensurePreapproval onboard failed user=${user.id.slice(0, 8)} @${preferredUsername}: ${onboard.detail ?? ''}`,
        );
        throw new BadRequestException(
          onboard.detail ?? 'Wallet not registered in Splice.',
        );
      }
      walletUsername = onboard.username ?? preferredUsername;
    }

    // Authoritative existence check across BOTH ledger views + splice. A plain
    // splice read that returns false on a transient error must NOT trigger a
    // re-create here — that would silently re-enable the preapproval the user
    // believes they disabled.
    const spliceExisting = await this.splice.getTransferPreapproval(
      user.cantonPartyId,
    );
    const existingAuth = await this.ledger.getTransferPreapprovalAuthoritative(
      user.cantonPartyId,
      {
        active: spliceExisting !== null,
        expiresAt: spliceExisting?.expiresAt,
        provider: spliceExisting?.provider,
      },
    );
    if (existingAuth.active) {
      return {
        active: true,
        partyId: user.cantonPartyId,
        username: walletUsername,
        message: 'TransferPreapproval is already active (CIP-56).',
      };
    }

    const created = await this.splice.createTransferPreapproval(walletUsername);
    if (!created.ok) {
      const chainBalance = await this.splice.getUserBalance(walletUsername);
      const hint =
        chainBalance === null || chainBalance <= 0
          ? ` On-chain balance for @${walletUsername} is ${chainBalance ?? 0} CC — need funds for the preapproval fee (~$1/year). UI balance may be a DB snapshot.`
          : ` On-chain balance: ${chainBalance} CC (@${walletUsername}).`;
      this.logger.warn(
        `ensurePreapproval failed user=${user.id.slice(0, 8)} wallet=@${walletUsername} status=${created.status ?? '?'} ${created.detail ?? ''}`,
      );
      throw new BadRequestException(
        (created.detail ?? 'Failed to create TransferPreapproval.') + hint,
      );
    }

    void this.featuredActivity
      .recordActivity(
        'wallet_created',
        user.cantonPartyId,
        `Preapproval enabled for @${user.username}`,
      )
      .catch(() => {});

    return {
      active: true,
      partyId: user.cantonPartyId,
      username: walletUsername,
      message:
        'TransferPreapproval active — CC from the validator wallet can arrive directly (CIP-56).',
    };
  }

  @SkipThrottle()
  @Get('preapproval-status')
  async preapprovalStatus(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId) {
      return {
        hasWallet: false,
        active: false,
        preapproval: { active: false, walletUiUrl: this.splice.walletUiUrl },
        message:
          'No wallet found. Create your wallet first from the Wallet page.',
      };
    }

    // M5b: For EXTERNAL users, check via validator API (ExternalPartySetupProposal
    // creates TransferPreapproval that may not be visible via splice's custodial lookup).
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
        // Validator API check failed — fallback to splice
      }
    }

    const [preapprovals, isPlaceholder] = await Promise.all([
      this.splice.getTransferPreapprovals(user.cantonPartyId),
      Promise.resolve(user.cantonPartyId.startsWith('canquest:')),
    ]);

    const active = preapprovals.length > 0;
    const walletUiUrl = this.splice.walletUiUrl;

    return {
      hasWallet: true,
      partyId: user.cantonPartyId,
      isPlaceholder,
      preapproval: {
        active,
        walletUiUrl,
        contracts: preapprovals,
        message: active
          ? `Preapproval active — direct CC transfers enabled. Expires: ${preapprovals[0]?.expiresAt ?? 'unknown'}`
          : 'No preapproval found. Visit your Splice Wallet UI and click "Create Preapproval" to enable direct CC transfers.',
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Preapproval Toggle — enable/disable TransferPreapproval
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * Get current preapproval status for the user's wallet.
   *
   * Uses the authoritative on-chain read (both Ledger ACS views + Splice REST
   * fallback). A plain Splice REST read can report inactive on any transient
   * error while a live contract keeps CC flowing in directly — so the source of
   * truth is the union of all sources.
   */
  @SkipThrottle()
  @Get('preapproval')
  async getPreapprovalStatus(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }

    const spliceStatus = await this.splice.getTransferPreapproval(
      user.cantonPartyId,
    );
    const auth = await this.ledger.getTransferPreapprovalAuthoritative(
      user.cantonPartyId,
      {
        active: spliceStatus !== null,
        expiresAt: spliceStatus?.expiresAt,
        provider: spliceStatus?.provider,
      },
    );

    return {
      active: auth.active,
      expiresAt: auth.expiresAt ?? null,
      provider: auth.provider ?? null,
      source: auth.source ?? null,
      message: auth.active
        ? 'Preapproval active — incoming CC transfers arrive directly without manual accept.'
        : 'Preapproval inactive — incoming CC transfers will appear as offers that you must accept manually.',
    };
  }

  @Post('preapproval/enable')
  async enablePreapproval(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (
      !user?.cantonPartyId ||
      !user.username ||
      !hasRealWallet(user.cantonPartyId)
    ) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }

    // Already active? (Authoritative read across all sources — don't burn the
    // preapproval fee if one is already live that a single source missed.)
    const spliceExisting = await this.splice.getTransferPreapproval(
      user.cantonPartyId,
    );
    const existing = await this.ledger.getTransferPreapprovalAuthoritative(
      user.cantonPartyId,
      {
        active: spliceExisting !== null,
        expiresAt: spliceExisting?.expiresAt,
        provider: spliceExisting?.provider,
      },
    );
    if (existing.active) {
      return {
        ok: true,
        alreadyActive: true,
        expiresAt: existing.expiresAt,
        message: 'Preapproval is already active.',
      };
    }

    // Cooldown 7 hari (hanya gate aksi yang benar-benar burn)
    this.assertPreapprovalToggleCooldown(user.preapprovalToggleAt);

    // Create via Ledger: exercise AmuletRules_CreateTransferPreapproval (validator-1 pays burn)
    const result = await this.ledger.createTransferPreapprovalViaLedger(
      user.cantonPartyId,
    );
    if (!result.ok) {
      throw new BadRequestException(
        result.error ?? 'Failed to create preapproval.',
      );
    }

    // Catat history (tx id = contract preapproval cid). Non-fatal: toggle tetap
    // sukses walau pencatatan gagal. Burn fee dicatat juga agar ada jejak.
    try {
      await this.users.recordTransaction({
        userId: user.id,
        amountCc: Number(result.amuletPaid ?? 0),
        type: 'PREAPPROVAL_ENABLED',
        description: 'Preapproval enabled — direct transfers',
        referenceId: user.cantonPartyId,
        // ledgerTxId + cantonUpdateId = Canton update_id ("1220…") untuk link explorer.
        // transferPreapprovalCid (contract_id) tidak disimpan di kolom tx — biarkan null
        // bila updateId tidak ada; link disembunyikan (bukan contract_id yang menyesatkan).
        ledgerTxId: result.updateId ?? undefined,
        cantonUpdateId: result.updateId ?? undefined,
      });
    } catch (err) {
      this.logger.warn(
        `PREAPPROVAL_ENABLED history record failed: ${String(err)}`,
      );
    }

    // Sukses & burn terjadi → set cooldown
    await this.users.markPreapprovalToggle(req.user.userId);

    return {
      ok: true,
      alreadyActive: false,
      transferPreapprovalCid: result.transferPreapprovalCid,
      amuletPaid: result.amuletPaid,
      message:
        'Preapproval enabled — incoming CC transfers will now arrive directly.',
    };
  }

  @Post('preapproval/disable')
  async disablePreapproval(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }

    // Authoritative read — checks BOTH ledger views + splice. A false-negative
    // here would make us skip the cancel entirely, so we union every source.
    const spliceStatus = await this.splice.getTransferPreapproval(
      user.cantonPartyId,
    );
    const auth = await this.ledger.getTransferPreapprovalAuthoritative(
      user.cantonPartyId,
      {
        active: spliceStatus !== null,
        expiresAt: spliceStatus?.expiresAt,
        provider: spliceStatus?.provider,
      },
    );
    if (!auth.active) {
      return {
        ok: true,
        wasActive: false,
        message: 'Preapproval is already inactive.',
      };
    }

    // Cooldown 7 hari (gate state-change)
    this.assertPreapprovalToggleCooldown(user.preapprovalToggleAt);

    // Cancel via Ledger (primary path). cancelTransferPreapprovalViaLedger now
    // re-verifies the contract is actually archived before reporting success.
    const result = await this.ledger.cancelTransferPreapprovalViaLedger(
      user.cantonPartyId,
    );
    if (!result.ok) {
      // Fallback: try Splice admin DELETE (sometimes the operator lacks CanActAs
      // on the receiver but the admin endpoint can archive it).
      const fallback = await this.splice.cancelTransferPreapproval(
        user.cantonPartyId,
      );
      if (!fallback.ok) {
        throw new BadRequestException(
          `Failed to disable preapproval: ${result.error ?? 'unknown'}`,
        );
      }
    }

    // Final verification — only trust the toggle succeeded if the authoritative
    // read now reports inactive. Otherwise surface the error so the UI does not
    // wrongly show "Disabled" while a live contract keeps CC flowing in.
    const postCheck = await this.ledger.getTransferPreapprovalAuthoritative(
      user.cantonPartyId,
    );
    if (postCheck.active) {
      throw new BadRequestException(
        'Preapproval could not be disabled on-chain — it is still active. ' +
          'Please retry in a moment, or contact support if it persists.',
      );
    }

    // Sukses & terverifikasi → set cooldown
    await this.users.markPreapprovalToggle(req.user.userId);

    // Catat history (tx id = updateId dari cancel exercise). Non-fatal: toggle
    // tetap sukses walau pencatatan gagal. Bila updateId tidak tersedia (e.g. lewat
    // Splice fallback path), ledgerTxId null — link explorer disembunyikan (bukan
    // marker palsu). NULL ledgerTxId aman: unique constraint Postgres mengizinkan
    // beberapa row NULL untuk userId yang sama.
    try {
      await this.users.recordTransaction({
        userId: user.id,
        amountCc: 0,
        type: 'PREAPPROVAL_DISABLED',
        description: 'Preapproval disabled — manual accept required',
        referenceId: user.cantonPartyId,
        ledgerTxId: result.updateId ?? undefined,
        cantonUpdateId: result.updateId ?? undefined,
      });
    } catch (err) {
      this.logger.warn(
        `PREAPPROVAL_DISABLED history record failed: ${String(err)}`,
      );
    }

    return {
      ok: true,
      wasActive: true,
      message:
        'Preapproval disabled — incoming CC transfers will now appear as offers.',
    };
  }
}
