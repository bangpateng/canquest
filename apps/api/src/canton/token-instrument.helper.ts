import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Token } from '@oneswap/sdk';
import { OneSwapClient } from '../oneswap/oneswap-client';

/**
 * Reward token symbol — dimensi terpisah dari RewardType (jenis alur klaim).
 * - "CC"    = Amulet (default, behavior lama).
 * - "USDCx" = utility-registry token (Circle USDC on Canton).
 *
 * Claim fee tetap CC untuk semua token. Token ini hanya menentukan token REWARD.
 */
export type RewardTokenSymbol = 'CC' | 'USDCx';

/** Coerce sembarang string DB → RewardTokenSymbol yang aman (default CC). */
export function normalizeRewardToken(
  value: string | null | undefined,
): RewardTokenSymbol {
  const v = (value ?? '').trim().toUpperCase();
  return v === 'USDCx'.toUpperCase() ? 'USDCx' : 'CC';
}

/** Canton instrument id untuk CC/Amulet. */
export const CC_INSTRUMENT_ID = 'Amulet';
/** Symbol OneSwap untuk CC. */
export const CC_SYMBOL = 'CC';

export interface InstrumentRef {
  instrumentId: string;
  instrumentAdmin: string;
}

/**
 * Resolver instrument (id + admin party) dari symbol token reward.
 *
 * Reuse pola SwapService.resolveToken/getTokenMap — cache listTokens() dari OneSwap
 * supaya tidak call API setiap klaim. Untuk CC tidak perlu call OneSwap sama sekali
 * (Amulet admin = CANTON_DSO_PARTY_ID dari env).
 *
 * Dipakai claim flow saat rewardToken = "USDCx" untuk:
 *  - executeTransferFactoryTransfer (butuh instrumentId + instrumentAdmin)
 *  - getTokenBalanceOnChain (butuh instrumentId) — cek saldo USDCx reward wallet
 */
@Injectable()
export class TokenInstrumentHelper {
  private readonly logger = new Logger(TokenInstrumentHelper.name);

  private tokenCache: { at: number; map: Map<string, Token> } | null = null;
  private static readonly TOKEN_CACHE_TTL_MS = 60_000;

  constructor(
    private readonly config: ConfigService,
    private readonly oneswap: OneSwapClient,
  ) {}

  /** Resolve instrument ref (id + admin) untuk symbol reward token. */
  async resolveInstrument(symbol: RewardTokenSymbol): Promise<InstrumentRef> {
    // CC/Amulet: admin = DSO party (dari env), tidak perlu OneSwap call.
    if (symbol === 'CC') {
      const admin = this.config.get<string>('CANTON_DSO_PARTY_ID')?.trim();
      if (!admin) {
        throw new Error(
          'CANTON_DSO_PARTY_ID not configured (required as Amulet instrumentAdmin)',
        );
      }
      return { instrumentId: CC_INSTRUMENT_ID, instrumentAdmin: admin };
    }

    // USDCx (dan token non-CC lain di masa depan): resolve via OneSwap cache.
    const map = await this.getTokenMap();
    const tok = map.get(symbol.toUpperCase());
    if (!tok) {
      throw new Error(
        `Token symbol "${symbol}" not found in OneSwap tokens list ` +
          `(tidak bisa resolve instrumentId/instrumentAdmin untuk reward).`,
      );
    }
    return { instrumentId: tok.id, instrumentAdmin: tok.admin };
  }

  /** Map symbol → Token dari OneSwap listTokens(), di-cache 60s (mirror SwapService). */
  private async getTokenMap(): Promise<Map<string, Token>> {
    if (
      this.tokenCache &&
      Date.now() - this.tokenCache.at < TokenInstrumentHelper.TOKEN_CACHE_TTL_MS
    ) {
      return this.tokenCache.map;
    }
    const tokens = await this.oneswap.listTokens();
    const map = new Map<string, Token>();
    for (const t of tokens) {
      map.set(t.symbol.toUpperCase(), t);
      // 'CC' symbol → juga map ke instrument id 'Amulet' (konsistensi dgn SwapService).
      if (t.id.toUpperCase() === CC_INSTRUMENT_ID.toUpperCase()) {
        map.set(CC_SYMBOL, t);
      }
    }
    this.tokenCache = { at: Date.now(), map };
    return map;
  }
}
