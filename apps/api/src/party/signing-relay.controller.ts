/**
 * Signing relay (M3) — endpoint dua-langkah untuk transaksi user external:
 *
 *   POST /party/sign/prepare  { flow, params }   → { hash, commandId, description }
 *   POST /party/sign/execute  { signature }      → { updateId, completionOffset }
 *
 * Browser menampilkan review + meminta passphrase, lalu menandatangani hash
 * dengan kunci user (signPreparedHash). Backend tidak pernah melihat kunci.
 */
import { AuthGuard } from '@nestjs/passport';
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { SigningRelayService } from '../canton/signing-relay.service';
import { ExecuteSignDto, PrepareSignDto } from './dto/signing-relay.dto';
import type { AuthedReq } from './party-shared';

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
}
