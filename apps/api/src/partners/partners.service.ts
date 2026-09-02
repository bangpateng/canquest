import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuestKind, QuestStatus } from '../common/prisma-types';

/** AppSetting key untuk social links global ecosystem (admin-managed). */
export const ECOSYSTEM_SOCIAL_LINKS_KEY = 'ecosystem_social_links';

/** Bentuk row partner yang dikirim ke web (JSON string di-parse jadi array). */
export interface PartnerDto {
  id: string;
  name: string;
  initials: string;
  logoUrl: string | null;
  category: string;
  categories: string[];
  about: string;
  website: string | null;
  socialLinks: Array<{ platform: string; url: string }>;
  team: Array<{
    initials: string;
    name: string;
    role: string;
    photoUrl?: string;
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
  likes: number;
  liked: boolean;
  featuredApp: boolean;
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
      category: string;
      categories?: string[];
      about: string;
      website: string | null;
      socialLinks: string;
      team: string;
      appsFeatured: string;
      features: string;
      validators: string;
      createdAt: Date;
      likes: number;
      featuredApp: boolean;
      likesBy?: Array<{ userId: string }>;
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
      categories:
        p.categories && p.categories.length > 0
          ? p.categories
          : p.category
            ? [p.category]
            : [],
      about: p.about,
      website: p.website,
      socialLinks: parseJsonArray(p.socialLinks),
      team: parseJsonArray(p.team),
      appsFeatured: parseJsonArray(p.appsFeatured),
      features: parseJsonArray(p.features),
      validators: parseJsonArray(p.validators),
      createdAt: p.createdAt,
      likes: p.likes ?? 0,
      featuredApp: p.featuredApp ?? false,
      liked: (p.likesBy ?? []).length > 0,
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
  async listPublished(
    category?: string,
    q?: string,
    userId?: string,
  ): Promise<PartnerDto[]> {
    const where: Record<string, unknown> = { published: true };
    if (category && category.trim()) {
      const cat = category.trim();
      where.OR = [{ categories: { has: cat } }, { category: cat }];
    }
    if (q && q.trim()) {
      where.OR = [
        { name: { contains: q.trim(), mode: 'insensitive' } },
        { about: { contains: q.trim(), mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.partner.findMany({
      where,
      orderBy: [{ likes: 'desc' }, { createdAt: 'desc' }],
      include: {
        quests: { select: { status: true, questKind: true } },
        ...(userId && {
          likesBy: { where: { userId }, select: { userId: true } },
        }),
      },
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

  /** Meta ecosystem: kategori (admin-managed) + social links global. */
  async getMeta(): Promise<{
    categories: Array<{ value: string; label: string }>;
    socialLinks: Array<{ platform: string; url: string }>;
  }> {
    const [categories, setting] = await Promise.all([
      this.prisma.ecosystemCategory.findMany({
        orderBy: { sortOrder: 'asc' },
        select: { value: true, label: true },
      }),
      this.prisma.appSetting.findUnique({
        where: { key: ECOSYSTEM_SOCIAL_LINKS_KEY },
      }),
    ]);
    let socialLinks: Array<{ platform: string; url: string }> = [];
    if (setting?.value) {
      try {
        const parsed = JSON.parse(setting.value);
        if (Array.isArray(parsed)) socialLinks = parsed;
      } catch {
        socialLinks = [];
      }
    }
    return { categories, socialLinks };
  }

  /** Toggle like — siapa pun yang login, tanpa batas waktu. */
  async toggleLike(
    partnerId: string,
    userId: string,
  ): Promise<{ likes: number; liked: boolean }> {
    const partner = await this.prisma.partner.findUnique({
      where: { id: partnerId },
      select: { id: true },
    });
    if (!partner) throw new NotFoundException('Partner not found');
    const existing = await this.prisma.partnerLike.findUnique({
      where: { partnerId_userId: { partnerId, userId } },
    });
    if (existing) {
      await this.prisma.$transaction([
        this.prisma.partnerLike.delete({
          where: { partnerId_userId: { partnerId, userId } },
        }),
        this.prisma.partner.update({
          where: { id: partnerId },
          data: { likes: { decrement: 1 } },
        }),
      ]);
      const after = await this.prisma.partner.findUniqueOrThrow({
        where: { id: partnerId },
        select: { likes: true },
      });
      return { likes: Math.max(0, after.likes), liked: false };
    }
    await this.prisma.$transaction([
      this.prisma.partnerLike.create({ data: { partnerId, userId } }),
      this.prisma.partner.update({
        where: { id: partnerId },
        data: { likes: { increment: 1 } },
      }),
    ]);
    const after = await this.prisma.partner.findUniqueOrThrow({
      where: { id: partnerId },
      select: { likes: true },
    });
    return { likes: after.likes, liked: true };
  }
}
