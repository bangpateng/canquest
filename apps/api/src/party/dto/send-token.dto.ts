import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Request body for POST /api/party/send-token — P2P transfer token non-CC
 * (USDCx, dll) via CIP-0056 on-chain two-step.
 *
 * Berbeda dengan SendCcDto (CC-only, satu endpoint /send-cc), DTO ini
 * instrument-aware: client wajib kirim instrumentId + instrumentAdmin yang
 * sudah didapat dari /api/party/swap/pools. Token CC (Amulet) HARUS pakai
 * /send-cc, bukan endpoint ini — divalidasi di controller.
 *
 * MAX_TRANSFER_TOKEN = ceiling defensif untuk token non-CC (Decimal(38,18)).
 * Aman besar karena amount di sini human-decimal (mis. 1000 USDCx), bukan micro.
 */
export const MAX_TRANSFER_TOKEN = 1_000_000_000;

/**
 * Pola party id Canton: alphanumeric + "::" + hex. Dipakai untuk membedakan
 * input recipient berupa username vs party id. Mirror pola di party.controller.
 */
const PARTY_ID_REGEX = /^[a-zA-Z0-9_-]+::[a-fA-F0-9]+$/;

export class SendTokenDto {
  /** Recipient — username ("@alice" / "alice") atau Canton party id ("alice::1220…"). */
  @IsString()
  @MinLength(1, { message: 'Recipient is required.' })
  @MaxLength(256)
  recipientUsername!: string;

  /** Jumlah token (human-decimal, mis. 5.5 untuk 5.5 USDCx). Bukan micro-unit. */
  @IsNumber()
  @Min(0.000001, { message: 'Amount must be greater than 0.' })
  @Max(MAX_TRANSFER_TOKEN, {
    message: 'Amount exceeds the per-transfer ceiling.',
  })
  amount!: number;

  /**
   * Cantex instrument id token yang dikirim, mis. "USDCX".
   * BUKAN "Amulet" (CC pakai /send-cc) — divalidasi di controller.
   */
  @IsString()
  @MinLength(1, { message: 'instrumentId is required.' })
  @MaxLength(64)
  instrumentId!: string;

  /**
   * Cantex instrument admin party (penerbit token), mis. "DSO::1220…".
   * Wajib untuk resolve TransferFactory token yang benar di registry CIP-0056.
   * Client dapat dari /api/party/swap/pools (field `admin` per token).
   */
  @IsString()
  @MinLength(1, { message: 'instrumentAdmin is required.' })
  @MaxLength(128)
  instrumentAdmin!: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  memo?: string;

  /**
   * Kata sandi transaksi opsional (wallet password). Wajib hanya bila user telah
   * menetapkan satu di Settings — diverifikasi di awal handler sebelum eksekusi.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  txVerification?: string;

  /**
   * Idempotency nonce — UUID baru per klik Send. Dipakai untuk derive commandId
   * ledger yang DETERMINISTIK sehingga double-click / retry / multi-tab yang kirim
   * nonce sama di-dedup oleh Canton menjadi SATU transfer (bukan dua). Frontend
   * wajib generate crypto.randomUUID() sekali per submit attempt.
   */
  @IsString()
  @MinLength(8, { message: 'Idempotency nonce is required.' })
  @MaxLength(64)
  clientNonce!: string;
}

/** Type-guard helper: apakah string input terlihat seperti Canton party id. */
export function looksLikeTokenPartyId(input: string): boolean {
  return PARTY_ID_REGEX.test(input.trim());
}
