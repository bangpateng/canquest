import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isPartnerCategory, PartnerCategory } from '../common/prisma-types';
import { QuestKind, QuestStatus } from '../common/prisma-types';

/** Bentuk row partner yang dikirim ke web (JSON string di-parse jadi array). */
export interface PartnerDto {
  id: string;
  name: string;
  initials: string;
  logoUrl: string | null;
  category: PartnerCategory;
  about: string;
  website: string | null;
  socialLinks: Array<{ platform: string; url: string }>;
  team: Array<{
    initials: string;
    name: string;
    role: string;
    socials: Array<{ platform: string; url: string }>;
  }>;
  appsFeatured: Array<{ name: string; description: string; url: string }>;
  features: Array<{ title: string; description: string }>;
  validators: Array<{
    label: string;
    partyId: string;
    network?: string;
    status?: string;
    explorerUrl?: string;
  }>;
  createdAt: Date;
  activeQuestCount?: number;
}

/** Parse kolom JSON string aman — default [] saat kosong/corrupt. */
function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

@Injectable()
export class PartnersService {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(
    p: {
      id: string;
      name: string;
      initials: string;
      logoUrl: string | null;
      category: PartnerCategory;
      about: string;
      website: string | null;
      socialLinks: string;
      team: string;
      appsFeatured: string;
      features: string;
      validators: string;
      createdAt: Date;
      quests?: Array<{ status: string; questKind: string }>;
    },
    withQuestCount = false,
  ): PartnerDto {
    const dto: PartnerDto = {
      id: p.id,
      name: p.name,
      initials: p.initials,
      logoUrl: p.logoUrl,
      category: p.category,
      about: p.about,
      website: p.website,
      socialLinks: parseJsonArray(p.socialLinks),
      team: parseJsonArray(p.team),
      appsFeatured: parseJsonArray(p.appsFeatured),
      features: parseJsonArray(p.features),
      validators: parseJsonArray(p.validators),
      createdAt: p.createdAt,
    };
    if (withQuestCount) {
      dto.activeQuestCount =
        p.quests?.filter(
          (q) => q.status === QuestStatus.ACTIVE && q.questKind === QuestKind.CAMPAIGN,
        ).length ?? 0;
    }
    return dto;
  }

  /** List partner published untuk halaman /ecosystem (filter kategori + search). */
  async listPublished(category?: string, q?: string): Promise<PartnerDto[]> {
    const where: Record<string, unknown> = { published: true };
    if (category && isPartnerCategory(category)) {
      where.category = category;
    }
    if (q && q.trim()) {
      where.OR = [
        { name: { contains: q.trim(), mode: 'insensitive' } },
        { about: { contains: q.trim(), mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.partner.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { quests: { select: { status: true, questKind: true } } },
    });
    return rows.map((r) => this.toDto(r, true));
  }

  /** Detail partner by id (untuk modal ecosystem). */
  async getById(id: string): Promise<PartnerDto> {
    const row = await this.prisma.partner.findFirst({
      where: { id, published: true },
      include: { quests: { select: { status: true, questKind: true } } },
    });
    if (!row) throw new NotFoundException('Partner not found');
    return this.toDto(row, true);
  }
}
