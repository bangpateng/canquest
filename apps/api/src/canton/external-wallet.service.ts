import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CantonWalletSdkService } from './wallet-sdk.service';

/**
 * ExternalWalletService — registrasi wallet non-custodial (external party).
 *
 * Alur dua-langkah (kunci private TIDAK PERNAH keluar dari browser user):
 *
 *   1. prepare(userId, publicKeyHex, partyHint)
 *      Browser mengirim PUBLIC KEY + partyHint (nama opaque "canquest-user-…").
 *      Backend meminta participant men-generate topology external party, lalu
 *      mengembalikan multiHash yang harus ditandatangani user.
 *
 *   2. complete(userId, signatureB64)
 *      Browser menandatangani multiHash dengan kunci Ed25519-nya (fungsi
 *      signPreparedHash di apps/web/lib/wallet/key-manager.ts — terverifikasi
 *      byte-per-byte vs SDK pada M0). Backend men-submit allocate dengan
 *      signature itu. Tanpa tanda tangan user, alokasi mustahil (terbukti M0:
 *      custodial actAs ditolak participant bahkan dengan CanActAs rights).
 *
 * Hasil allocate: party external di validator CanQuest — kuncinya sepenuhnya
 * milik user, nama party opaque (privasi), namespace fingerprint unik per user.
 *
 * State pending disimpan in-memory (Map per userId, TTL 10 menit) — registrasi
 * adalah sesi singkat; restart API di tengah alur cukup diulang user.
 *
 * Feature flag: EXTERNAL_WALLET_ENABLED (default off) — dual-run dengan jalur
 * custodial lama sampai M4 selesai.
 */

const PENDING_TTL_MS = 10 * 60 * 1000;

interface PendingExternalRegistration {
  userId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepared: any; // PreparedPartyCreationService — prepared-object SDK harus hidup antar panggilan
  topology: {
    partyId: string;
    publicKeyFingerprint: string;
    multiHash: string;
  };
  hint: string;
  createdAt: number;
}

@Injectable()
export class ExternalWalletService {
  private readonly logger = new Logger(ExternalWalletService.name);
  private readonly pending = new Map<string, PendingExternalRegistration>();

  constructor(
    private readonly sdkProvider: CantonWalletSdkService,
    private readonly config: ConfigService,
  ) {}

  get isEnabled(): boolean {
    const flag = this.config.get<string>('EXTERNAL_WALLET_ENABLED');
    return flag === 'true' || flag === '1';
  }

  private assertEnabled(): void {
    if (!this.isEnabled) {
      throw new BadRequestException(
        'Non-custodial wallet is not enabled yet (EXTERNAL_WALLET_ENABLED).',
      );
    }
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.pending) {
      if (now - entry.createdAt > PENDING_TTL_MS) this.pending.delete(key);
    }
  }

  /**
   * Langkah 1: generate topology external party. TIDAK meng-commit apa pun —
   * hanya menyiapkan dan mengembalikan multiHash untuk ditandatangani user.
   */
  async prepare(
    userId: string,
    publicKeyHex: string,
    partyHint: string,
  ): Promise<{ multiHash: string; partyIdPreview: string }> {
    this.assertEnabled();
    this.sweepExpired();

    if (!/^[0-9a-fA-F]{64}$/.test(publicKeyHex.trim())) {
      throw new BadRequestException(
        'Public key must be 64 hex characters (Ed25519).',
      );
    }
    if (!/^canquest-user-[0-9a-f]{6,32}$/.test(partyHint)) {
      throw new BadRequestException(
        'partyHint must be in canquest-user-<hex> format (client-generated).',
      );
    }
    if (this.pending.has(userId)) {
      throw new BadRequestException(
        'A registration is still in progress — complete it or wait 10 minutes.',
      );
    }

    const sdk = await this.sdkProvider.getSdk();
    const publicKeyB64 = Buffer.from(publicKeyHex.trim(), 'hex').toString(
      'base64',
    );

    const prepared = sdk.party.external.create(publicKeyB64, { partyHint });
    const topology = await prepared.topology();

    this.pending.set(userId, {
      userId,
      prepared,
      topology,
      hint: partyHint,
      createdAt: Date.now(),
    });

    this.logger.log(
      `prepare external party user=${userId.slice(0, 8)}… hint=${partyHint}`,
    );
    return { multiHash: topology.multiHash, partyIdPreview: topology.partyId };
  }

  /**
   * Langkah 2: allocate dengan signature user. grantUserRights sengaja FALSE —
   * M0 membuktikan CanActAs operator tidak berguna untuk party external, dan
   * higienisnya rights tidak diberikan sama sekali (baca saldo ditangani
   * CanReadAs-only oleh CantonLedgerService.grantReadRightsOnParty).
   */
  async complete(
    userId: string,
    signatureB64: string,
  ): Promise<{ partyId: string; fingerprint: string }> {
    this.assertEnabled();

    const entry = this.pending.get(userId);
    if (!entry) {
      throw new BadRequestException(
        'No registration session — start again from the prepare step (TTL 10 minutes).',
      );
    }
    if (typeof signatureB64 !== 'string' || signatureB64.length < 16) {
      throw new BadRequestException('Invalid signature.');
    }

    try {
      const res = await entry.prepared.execute(signatureB64, {
        grantUserRights: false,
      });
      this.pending.delete(userId);
      this.logger.log(
        `external party AKTIF user=${userId.slice(0, 8)}… party=${res.partyId.split('::')[0]}`,
      );
      return { partyId: res.partyId, fingerprint: res.publicKeyFingerprint };
    } catch (err) {
      // Entry dipertahankan agar user bisa retry signature tanpa prepare ulang.
      this.logger.warn(
        `allocate external party gagal user=${userId.slice(0, 8)}…: ${String(err).slice(0, 200)}`,
      );
      throw new BadRequestException(
        `Party allocation failed: ${String((err as Error)?.message ?? err).slice(0, 180)}`,
      );
    }
  }

  /** Untuk cleanup/testing internal. */
  discard(userId: string): void {
    this.pending.delete(userId);
  }
}
