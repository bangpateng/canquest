/**
 * Swap OneSwap: quote, eksekusi, status + market (pools/prices/balance).
 *
 * Diekstraksi dari party.controller.ts — route path & behavior identik.
 */
import {
  AmbiguousPoolPairError,
  NoDirectPoolError,
  OneSwapError,
} from '../oneswap/oneswap.types';
import { AuthGuard } from '@nestjs/passport';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { CC_INSTRUMENT_ID, CC_SYMBOL } from '../canton/token-instrument.helper';
import { CantonLedgerService } from '../canton/canton-ledger.service';
import { CantonPriceService } from '../canton/canton-price.service';
import { OneSwapClient } from '../oneswap/oneswap-client';
import { PrismaService } from '../prisma/prisma.service';
import { SkipThrottle } from '@nestjs/throttler';
import { SwapDto, SwapQuoteDto } from './dto/swap.dto';
import { SwapService } from '../oneswap/swap.service';
import { UsersService } from '../users/users.service';
import { getOneSwapConfig, isOneSwapEnabled } from '../oneswap/oneswap.config';
import { hasRealWallet } from '../common/wallet-policy';
import { isSwapInstrument, isVisibleInstrument } from './visible-instruments';
import type { AuthedReq } from './party-shared';

/** Swap OneSwap: quote, eksekusi, status + market (pools/prices/balance). Prefix & guard sama dengan controller party lama. */
@Controller('party')
@UseGuards(AuthGuard('jwt'))
export class PartySwapController {
  private readonly logger = new Logger(PartySwapController.name);

  constructor(
    private readonly users: UsersService,
    private readonly ledger: CantonLedgerService,
    private readonly prisma: PrismaService,
    private readonly oneswap: OneSwapClient,
    private readonly cantonPrices: CantonPriceService,
    private readonly swapService: SwapService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════
  // SWAP — OneSwap DEX integration (CC ↔ semua token via OneSwap).
  // Custodial: backend transfer input user → OneSwap depositParty → output
  // balik ke party user. Token non-CC saldo dari on-chain (ledger).
  // ═══════════════════════════════════════════════════════════════════════
  /** GET /party/swap/status — apakah fitur swap aktif (ONESWAP_API_KEY diset).
   *  Juga kirim minimum swap dari env supaya frontend tidak hardcode (user bisa
   *  set ONESWAP_MIN_AMOUNT_CC / ONESWAP_MIN_AMOUNT_TOKEN tanpa rebuild FE). */
  @Get('swap/status')
  @SkipThrottle()
  swapStatus() {
    const enabled = isOneSwapEnabled();
    const cfg = getOneSwapConfig();
    return {
      enabled,
      phase: 'execution',
      executionReady: enabled,
      message: enabled ? 'Swap is live.' : 'Swap not enabled.',
      // Minimum swap dari env (ONESWAP_MIN_AMOUNT_CC / _TOKEN). FE pakai ini
      // untuk gate tombol swap + pesan "Min X to swap".
      minAmountCc: cfg.minAmountCc,
      minAmountToken: cfg.minAmountToken,
    };
  }

  /**
   * GET /party/balances — saldo user untuk SEMUA token (CC + non-CC).
   * Dipakai frontend untuk tombol percent (25/50/75/MAX) di setiap token,
   * bukan cuma CC. CC saldo dari CcBalance (on-chain mirror); token non-CC
   * di-merge: on-chain holdings (sumber kebenaran) + DB custody (off-chain).
   *
   * FIX-1b: saldo non-CC sekarang PURE on-chain (sumber kebenaran).
   * Sebelumnya: merge max(DB, on-chain) — DB off-chain (CantexTokenBalance)
   * tetap tampil walau bukan token asli (drift dari swap fallback). User minta
   * hapus off-chain: pakai on-chain saja. DB CantexTokenBalance tetap dipakai
   * untuk swap accounting internal, tapi TIDAK ditampilkan ke UI.
   */
  @Get('balance')
  @SkipThrottle()
  async swapBalances(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user) {
      throw new ForbiddenException('User not found.');
    }
    // CC saldo (micro → decimal) — dari DB (CcBalance = on-chain mirror, reliable).
    const ccBal = await this.prisma.ccBalance.findUnique({
      where: { userId: user.id },
      select: { balanceMicroCc: true },
    });
    const ccAmount = ccBal ? Number(ccBal.balanceMicroCc) / 1_000_000 : 0;

    // ON-CHAIN AUTHORITATIVE token saldo (source of truth = ledger, BUKAN DB).
    //
    // Sebelumnya saldo token di-build dari DB off-chain. Tapi DB bisa stale/
    // salah kalau handler miss event (restart, gap create-archive). User report
    // "saya sudah swap + WD tapi USDCx 0" — karena DB tidak reflect state ledger
    // sebenarnya. Solusi benar: query on-chain langsung tiap buka wallet.
    //
    // FIX (per konfirmasi Canton AI): pakai InterfaceFilter dengan interface ID
    // `#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding`.
    // WildcardFilter (lama) return [] karena token holding hanya visible via
    // interface, bukan template langsung. InterfaceFilter lihat holding dengan
    // benar untuk party tsb (filtersByParty scope per-party).
    //
    // Strategi:
    //   1. ON-CHAIN: queryTokenHoldingsByInterface(user.partyId) → authoritative
    //   2. FALLBACK: kalau on-chain return {} (ledger unreachable / timeout),
    //      gunakan DB (CantexTokenBalance) supaya wallet tidak blank total.
    //   3. Whitelist filter (USDCx, CBTC) + ensure entri 0 untuk UI.
    const tokens: Record<string, string> = {};
    const partyId = user.cantonPartyId;
    let usedFallback = false;

    // ── 1. ON-CHAIN (authoritative) ────────────────────────────────────────
    if (partyId) {
      try {
        const onChain =
          await this.ledger.queryTokenHoldingsByInterface(partyId);
        if (Object.keys(onChain).length > 0) {
          for (const [id, amount] of Object.entries(onChain)) {
            if (!isVisibleInstrument(id)) continue; // whitelist
            tokens[id] = amount.toFixed(10);
          }
        } else {
          // On-chain return {} — bisa berarti user emang gak pegang token,
          // ATAU ledger query gagal (timeout/unreachable). Cek DB sebagai
          // fallback supaya kalau ledger bermasalah, saldo lama tetap tampil.
          usedFallback = true;
        }
      } catch (err) {
        this.logger.warn(
          `swapBalances on-chain query failed (fallback to DB): ${String(err)}`,
        );
        usedFallback = true;
      }
    } else {
      // User belum bind party → gak bisa query on-chain. Pakai DB aja.
      usedFallback = true;
    }

    // ── 2. FALLBACK: DB off-chain (kalau on-chain gagal/kosong) ─────────────
    if (usedFallback) {
      try {
        const dbBalances = await this.prisma.cantexTokenBalance.findMany({
          where: { userId: user.id },
          select: { instrumentId: true, balance: true },
        });
        const byInst = new Map<string, number>();
        for (const b of dbBalances) {
          if (!isVisibleInstrument(b.instrumentId)) continue;
          if (b.instrumentId.toLowerCase() === 'amulet') continue;
          const id = b.instrumentId.toLowerCase();
          byInst.set(id, (byInst.get(id) ?? 0) + Number(b.balance));
        }
        for (const [id, amount] of byInst) {
          tokens[id] = amount.toFixed(10);
        }
      } catch (err) {
        this.logger.warn(
          `swapBalances DB fallback query failed: ${String(err)}`,
        );
      }
    }

    // ── 3. Ensure whitelist token selalu ada entri (balance 0 kalau belum pegang)
    // supaya UI bisa render baris USDCx/CBTC walau saldo 0.
    for (const sym of ['USDCX', 'CBTC']) {
      const id = sym.toLowerCase();
      if (!(id in tokens)) tokens[id] = '0';
    }

    return {
      cc: ccAmount,
      tokens,
    };
  }

  /**
   * GET /party/prices — harga USD semua token dari sumber Canton.
   * CC (Amulet) dari scan-proxy open-and-issuing-mining-rounds (amuletPrice),
   * USDCx = $1 anchor (hardcode). Cache 30s di CantonPriceService.
   * Dipakai frontend untuk total balance USD + per-token fiat value.
   *
   * Tidak bergantung pada OneSwap enabled flag — scan-proxy selalu available
   * selama validator up. OneSwap hanya dipakai untuk ambil admin token
   * (key matching dengan /party/pools).
   */
  @Get('prices')
  @SkipThrottle()
  async swapPrices() {
    try {
      const prices = await this.cantonPrices.getTokenPrices();
      // Filter + normalize key ke instrumentId lowercase (KONSISTEN dengan
      // /balances yang key-nya instrumentId lowercase doang).
      // Sebelumnya key = "<id>::<admin>" → frontend harus prefix-scan untuk
      // match. Sekarang key = "<id>" (lowercase) → lookup langsung.
      const filtered: Record<string, number> = {};
      for (const [key, price] of Object.entries(prices)) {
        const instrumentId = key.split('::')[0].toLowerCase();
        if (!isVisibleInstrument(instrumentId)) continue;
        // Kalau 2 admin variant (mis. USDCx dari 2 registrar), ambil harga
        // pertama (harga token sama untuk semua admin variant).
        if (!(instrumentId in filtered)) {
          filtered[instrumentId] = price;
        }
      }
      return { prices: filtered, source: 'canton_scan_proxy' };
    } catch (err) {
      this.logger.error(
        `prices failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw new ServiceUnavailableException(
        'Could not fetch token prices. Try again later.',
      );
    }
  }

  /**
   * GET /party/pools — daftar token yang tersedia untuk swap (dari OneSwap).
   * User bisa pilih token mana pun di slot atas ATAU bawah.
   * Live dari OneSwap (read-only, no risk).
   */
  @Get('pools')
  @SkipThrottle()
  async swapPools(@Req() req: AuthedReq) {
    if (!isOneSwapEnabled()) {
      throw new ServiceUnavailableException('Swap is not enabled.');
    }
    // Wallet gate — swap butuh wallet (CC ada di party user).
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new ForbiddenException(
        'You need a Canton wallet to use swap. Create yours first.',
      );
    }
    try {
      const tokens = await this.oneswap.listTokens();
      const isCc = (id: string) =>
        id.toLowerCase() === CC_INSTRUMENT_ID.toLowerCase();
      return {
        // Filter: hanya token yang bisa di-swap (CC + USDCx). CBTC Coming soon.
        tokens: tokens
          .filter((t) => isSwapInstrument(t.id))
          .map((t) => ({
            // Display symbol untuk swap picker OneSwap ('CC', 'USDCX').
            symbol: isCc(t.id) ? CC_SYMBOL : t.symbol,
            instrumentId: t.id,
            instrumentAdmin: t.admin,
            isCC: isCc(t.id),
          })),
      };
    } catch (err) {
      this.logger.error(
        `pools failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw new ServiceUnavailableException(
        'Could not reach OneSwap. Try again later.',
      );
    }
  }

  /**
   * POST /party/swap/quote — live swap quote (preview sebelum konfirmasi).
   * Tampilkan: output estimate, price impact, fee breakdown (OneSwap native).
   * Live dari OneSwap (read-only, no risk).
   */
  @Post('swap/quote')
  @SkipThrottle()
  async swapQuote(@Req() req: AuthedReq, @Body() body: SwapQuoteDto) {
    if (!isOneSwapEnabled()) {
      throw new ServiceUnavailableException('Swap is not enabled.');
    }
    // Validasi: from != to (tidak bisa swap token ke dirinya sendiri).
    if (body.from === body.to) {
      throw new BadRequestException(
        'Cannot swap a token to itself. Select different tokens.',
      );
    }
    try {
      const quote = await this.oneswap.getQuote({
        from: body.from,
        to: body.to,
        amount: body.amount,
      });
      // Shape OneSwap native sesuai dokumentasi Quote type. Field:
      //  - amountOut        : output yang dibeli user
      //  - effInput         : input aktual di-swap SETELAH networkFeeIn dipotong
      //  - networkFeeIn     : biaya Canton network (dipotong dari input, gasless)
      //  - lpFee/platformFee: dekomposisi pool fee (swapFeeBps). effFeeBps = setelah diskon
      //  - priceImpactPct   : impact ke harga pool
      return {
        amountOut: quote.amountOut,
        priceImpactPct: quote.priceImpactPct,
        effInput: quote.effInput,
        networkFeeIn: quote.networkFeeIn,
        platformFee: quote.platformFee,
        lpFee: quote.lpFee,
        swapFeeBps: quote.swapFeeBps,
        effFeeBps: quote.effFeeBps,
        poolId: quote.poolId,
        inSym: quote.inSym ?? body.from,
      };
    } catch (err) {
      // NoDirectPoolError / AmbiguousPoolPairError = error user-facing jelas.
      if (err instanceof NoDirectPoolError) {
        throw new BadRequestException(
          `No direct pool for ${body.from}↔${body.to}. Try a different pair.`,
        );
      }
      if (err instanceof AmbiguousPoolPairError) {
        throw new BadRequestException(
          `Multiple pools exist for ${body.from}↔${body.to}. Pair selection is required.`,
        );
      }
      if (err instanceof OneSwapError) {
        this.logger.warn(`swap/quote OneSwap error: ${err.message}`);
        throw new BadRequestException(`Could not get quote: ${err.message}`);
      }
      this.logger.error(
        `swap/quote failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw new ServiceUnavailableException(
        'Could not reach OneSwap. Try again later.',
      );
    }
  }

  @Post('swap')
  async swap(@Req() req: AuthedReq, @Body() body: SwapDto) {
    if (!isOneSwapEnabled()) {
      throw new ServiceUnavailableException('Swap is not enabled.');
    }
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new ForbiddenException(
        'You need a Canton wallet to use swap. Create yours first.',
      );
    }
    const result = await this.swapService.executeSwap(req.user.userId, {
      from: body.from,
      to: body.to,
      amount: body.amount,
      clientNonce: body.clientNonce,
    });
    if (!result.success) {
      throw new BadRequestException(
        result.message ?? 'Swap failed. Please try again.',
      );
    }
    return {
      success: true,
      direction: result.direction,
      outputAmount: result.outputAmount,
      swapId: result.swapId,
    };
  }
}
