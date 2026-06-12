import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

/**
 * SpliceWalletManagerService — Canton HTTP JSON API v2 wrapper for wallet admin.
 *
 * Menangani skenario:
 *   1. Toggle pre-approval (One-Step Transfer ON/OFF) via ledger exercise.
 *   2. Query inbound TransferInstructionV1 offers (CC masuk menggantung).
 *   3. Accept / reject inbound offers via ledger exercise.
 *
 * Semua endpoint memakai Canton HTTP JSON API (port 7575 by default, diambil
 * dari env CANTON_JSON_API_URL).  Tidak hardcode port — baca dari ConfigService.
 *
 * Official docs:
 *   https://docs.canton.network/appdev/modules/m4-json-api-tutorial
 *   https://docs.canton.network/appdev/modules/m4-backend-dev
 */
@Injectable()
export class SpliceWalletManagerService {
  private readonly logger = new Logger(SpliceWalletManagerService.name);
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (
      config.get<string>('CANTON_JSON_API_URL') ?? 'http://127.0.0.1:7575'
    ).replace(/\/$/, '');
  }

  /* ──────────────────────────────────────────────────────────────────
   * Helpers
   * ────────────────────────────────────────────────────────────────── */

  /** Auth headers for Canton JSON API (JWT Bearer + Content-Type). */
  private authHeaders(jwtToken: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwtToken}`,
    };
  }

  /** Generic POST to {baseUrl}/v1/{endpoint} with full error handling. */
  private async post(endpoint: string, body: unknown, jwtToken: string) {
    const url = `${this.baseUrl}/v1/${endpoint}`;
    this.logger.debug(`POST ${url}`);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.authHeaders(jwtToken),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });

      const text = await res.text();

      if (!res.ok) {
        const detail = text.slice(0, 600);
        this.logger.error(`POST ${endpoint} HTTP ${res.status}: ${detail}`);
        throw new BadRequestException(
          `Canton JSON API returned ${res.status}: ${detail}`,
        );
      }

      try {
        return JSON.parse(text);
      } catch {
        this.logger.warn(`POST ${endpoint} returned non-JSON: ${text.slice(0, 200)}`);
        return { raw: text };
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;

      const msg = String(err);
      this.logger.error(`POST ${endpoint} network error: ${msg}`);
      throw new BadRequestException(
        `Cannot reach Canton JSON API at ${this.baseUrl}. Check SSH tunnel. Details: ${msg.slice(0, 200)}`,
      );
    }
  }

  /* ──────────────────────────────────────────────────────────────────
   * 1. Toggle Pre-Approval (One-Step Transfer ON/OFF)
   * ────────────────────────────────────────────────────────────────── */

  /**
   * Update pre-approval status for a wallet config contract.
   *
   * @param jwtToken      JWT Bearer token for the Canton ledger API user
   * @param contractId    Contract ID of the Splice.Wallet:WalletConfig contract
   * @param enabled       true = enable One-Step Transfer, false = disable
   */
  async updatePreApprovalStatus(
    jwtToken: string,
    contractId: string,
    enabled: boolean,
  ): Promise<{ ok: boolean; updateId?: string }> {
    this.logger.log(
      `updatePreApprovalStatus: contractId=${contractId.slice(0, 20)}… enabled=${enabled}`,
    );

    const body = {
      templateId:
        '0200b3e528cc0b3a7a2ddf07ba796312fe35bd19fd9d6b6de3cb08f126631a05:Splice.Wallet:WalletConfig',
      contractId,
      choice: 'WalletConfig_UpdatePreApproval',
      argument: { preApprovalEnabled: enabled },
    };

    const data = await this.post('exercise', body, jwtToken);

    return {
      ok: true,
      updateId: typeof data?.updateId === 'string' ? data.updateId : undefined,
    };
  }

  /* ──────────────────────────────────────────────────────────────────
   * 2. Ambil Kotak Masuk (Inbound TransferInstructionV1 Offers)
   * ────────────────────────────────────────────────────────────────── */

  /**
   * Query inbound TransferInstructionV1 contracts where the user is the receiver.
   *
   * @param jwtToken       JWT Bearer token
   * @param userPartyId    Full Canton Party ID of the receiver
   */
  async getInboundOffers(
    jwtToken: string,
    userPartyId: string,
  ): Promise<InboundOffer[]> {
    this.logger.log(`getInboundOffers for receiver: ${userPartyId.split('::')[0]}`);

    const body = {
      templateIds: ['Splice.Api.Token:TransferInstructionV1'],
      query: { receiver: userPartyId },
    };

    const data = await this.post('query', body, jwtToken);

    // Canton query returns Array<{ contractId, createArgument, ... }>
    const rows = Array.isArray(data) ? data : data?.contracts ?? data?.results ?? [];

    const offers: InboundOffer[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const args =
        (row as Record<string, unknown>).createArgument ??
        (row as Record<string, unknown>).payload;
      if (!args) continue;

      const a = args as Record<string, unknown>;
      offers.push({
        contractId: (row as Record<string, unknown>).contractId as string ?? '',
        sender:
          typeof a.sender === 'string'
            ? a.sender
            : (a.sender as Record<string, string> | undefined)?.id ?? '',
        receiver:
          typeof a.receiver === 'string'
            ? a.receiver
            : (a.receiver as Record<string, string> | undefined)?.id ?? '',
        amount: (parseFloat(String(a.amount ?? '0')) || 0) / 1_000_000,
        description: typeof a.description === 'string' ? a.description : '',
        trackingId: typeof a.trackingId === 'string' ? a.trackingId : '',
      });
    }

    this.logger.log(`getInboundOffers returned ${offers.length} offer(s)`);
    return offers;
  }

  /* ──────────────────────────────────────────────────────────────────
   * 3. Eksekusi Terima / Tolak Offer
   * ────────────────────────────────────────────────────────────────── */

  /**
   * Accept or reject a TransferInstructionV1 offer.
   *
   * @param jwtToken    JWT Bearer token
   * @param contractId  Contract ID of the TransferInstructionV1 to act on
   * @param action      'accept' → exercise Accept, 'reject' → exercise Reject
   */
  async handleInboundOfferDecision(
    jwtToken: string,
    contractId: string,
    action: 'accept' | 'reject',
  ): Promise<{ ok: boolean; updateId?: string; action: string }> {
    const choice =
      action === 'accept'
        ? 'TransferInstruction_Accept'
        : 'TransferInstruction_Reject';

    this.logger.log(
      `handleInboundOfferDecision: ${action} contractId=${contractId.slice(0, 20)}…`,
    );

    const body = {
      templateId: 'Splice.Api.Token:TransferInstructionV1',
      contractId,
      choice,
      argument: {},
    };

    const data = await this.post('exercise', body, jwtToken);

    return {
      ok: true,
      action,
      updateId: typeof data?.updateId === 'string' ? data.updateId : undefined,
    };
  }
}

/** Shape of a deserialised inbound TransferInstruction offer. */
export interface InboundOffer {
  contractId: string;
  sender: string;
  receiver: string;
  amount: number;
  description: string;
  trackingId: string;
}