import { Global, Module } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

/**
 * Global module supaya SupabaseService bisa di-inject di mana pun (JwtStrategy,
 * AuthService, dll) tanpa import berulang.
 */
@Global()
@Module({
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class SupabaseModule {}
