import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { MaintenanceService } from './maintenance.service';

/**
 * Guard global mode maintenance.
 *
 * Dijalankan untuk SEMUA request API. Saat maintenance aktif, request yang
 * BUKAN exempt ditolak dengan 503 Service Unavailable.
 *
   * Exempt (selalu lewat, bahkan saat maintenance):
   *   - /api/health        → liveness/readiness probe infra tidak boleh gagal.
   *   - /api/admin         → admin harus bisa mematikan maintenance (recovery).
   *   - /api/public/maintenance → status publik agar FE bisa baca & tampilkan.
   *   - /api/realtime      → koneksi SSE panjang; idle saat maintenance tidak
   *                          membahayakan, dan deteksi maintenance FE lewat
   *                          poll gate terpisah (cq:maintenance via apiFetch).
   *
   * Body 503 memuat flag `maintenance: true` supaya FE (apiFetch) bisa bedakan
   * dari error 503 biasa dan langsung memunculkan overlay maintenance.
   */
  @Injectable()
  export class MaintenanceGuard implements CanActivate {
    /** Path prefix yang selalu diizinkan saat maintenance. */
    private static readonly EXEMPT_PREFIXES = [
      '/api/health',
      '/api/admin',
      '/api/public/maintenance',
      '/api/realtime',
    ];

  constructor(private readonly maintenance: MaintenanceService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const path = req.path;

    if (this.isExempt(path)) return true;

    const status = await this.maintenance.getStatus();
    if (!status.enabled) return true;

    throw new ServiceUnavailableException({
      message: status.message || 'Service unavailable',
      maintenance: true,
      title: status.title,
      estimatedEnd: status.estimatedEnd,
    });
  }

  private isExempt(path: string): boolean {
    return MaintenanceGuard.EXEMPT_PREFIXES.some((p) => path.startsWith(p));
  }
}
