/**
 * Signing relay (M3+M5b) — endpoint dua-langkah untuk transaksi user external:
 *
 *   POST /party/sign/prepare  { flow, params }   → { hash, commandId, description }
 *   POST /party/sign/execute  { signature }      → { updateId, completionOffset }
 *   POST /party/sign/preapproval/prepare  { publicKeyHex }  → { hash }
 *   POST /party/sign/preapproval/execute  { signature }     → { cid, updateId }
 *
 * Preapproval flow berbeda dari relay biasa: prepare & submit via VALIDATOR API,
 * hash = raw 32 bytes (TANPA 1220 prefix), browser sign raw bytes.
 */
import { AuthGuard } from '@nestjs/passport';
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { SigningRelayService } from '../canton/signing-relay.service';
import { ExecuteSignDto, PrepareSignDto } from './dto/signing-relay.dto';
import type { AuthedReq } from './party-shared';
import { IsString, Matches, MinLength } from 'class-validator';

class PreapprovalPrepareDto {
  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/, { message: 'publicKeyHex must be 64 hex chars' })
  publicKeyHex!: string;
}

class PreapprovalExecuteDto {
  @IsString()
  @MinLength(64)
  signature!: string;
}

@Controller('party/sign')
@UseGuards(AuthGuard('jwt'))
export class SigningRelayController {
  constructor(private readonly relay: SigningRelayService) {}

  @Post('prepare')
  async prepare(@Req() req: AuthedReq, @Body() dto: PrepareSignDto) {
    return this.relay.prepare(req.user.userId, dto.flow, dto.params ?? {});
  }

  @Post('execute')
  async execute(@Req() req: AuthedReq, @Body() dto: ExecuteSignDto) {
    return this.relay.execute(req.user.userId, dto.signature);
  }

  /** M5b: Preapproval prepare — hash raw 32 bytes TANPA 1220 prefix. */
  @Post('preapproval/prepare')
  async preparePreapproval(@Req() req: AuthedReq, @Body() dto: PreapprovalPrepareDto) {
    return this.relay.preparePreapproval(req.user.userId, dto.publicKeyHex);
  }

  /** M5b: Preapproval execute — signature hex dari browser. */
  @Post('preapproval/execute')
  async executePreapproval(@Req() req: AuthedReq, @Body() dto: PreapprovalExecuteDto) {
    return this.relay.executePreapproval(req.user.userId, dto.signature);
  }

  /** M5b: Preapproval disable — via validator API DELETE (operator cancels as provider). */
  @Post('preapproval/disable')
  async disablePreapproval(@Req() req: AuthedReq) {
    return this.relay.disablePreapproval(req.user.userId);
  }
}
