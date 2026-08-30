-- Ecosystem: kategori jadi tabel admin-managed + fitur like partner.

-- 1) Partner.category: enum -> String (nilai tetap, kini referensi EcosystemCategory.value)
ALTER TABLE "Partner" ALTER COLUMN "category" TYPE TEXT;

-- 2) Like counter (denormalized; baris PartnerLike menjaga kejujurannya)
ALTER TABLE "Partner" ADD COLUMN "likes" INTEGER NOT NULL DEFAULT 0;

-- 3) Tabel kategori ecosystem (seed 14 kategori bawaan)
CREATE TABLE "EcosystemCategory" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EcosystemCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EcosystemCategory_value_key" ON "EcosystemCategory"("value");

INSERT INTO "EcosystemCategory" ("id", "value", "label", "sortOrder") VALUES
  (replace(gen_random_uuid()::text, '-', ''), 'COMPLIANCE',         'Compliance', 1),
  (replace(gen_random_uuid()::text, '-', ''), 'CUSTODY',            'Custody', 2),
  (replace(gen_random_uuid()::text, '-', ''), 'DATA_ANALYTICS',     'Data & Analytics', 3),
  (replace(gen_random_uuid()::text, '-', ''), 'DEVELOPER_TOOLS',    'Developer Tools', 4),
  (replace(gen_random_uuid()::text, '-', ''), 'EXCHANGES',          'Exchanges', 5),
  (replace(gen_random_uuid()::text, '-', ''), 'FINANCING',          'Financing', 6),
  (replace(gen_random_uuid()::text, '-', ''), 'FORENSICS_SECURITY', 'Forensics & Security', 7),
  (replace(gen_random_uuid()::text, '-', ''), 'INTEROPERABILITY',   'Interoperability', 8),
  (replace(gen_random_uuid()::text, '-', ''), 'LIQUIDITY',          'Liquidity', 9),
  (replace(gen_random_uuid()::text, '-', ''), 'NAAS',               'NaaS', 10),
  (replace(gen_random_uuid()::text, '-', ''), 'PAYMENTS',           'Payments', 11),
  (replace(gen_random_uuid()::text, '-', ''), 'STABLECOINS',        'Stablecoins', 12),
  (replace(gen_random_uuid()::text, '-', ''), 'TOKENIZED_ASSETS',   'Tokenized Assets', 13),
  (replace(gen_random_uuid()::text, '-', ''), 'WALLETS',            'Wallets', 14);

-- 4) Like: satu baris per user per partner
CREATE TABLE "PartnerLike" (
    "partnerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerLike_pkey" PRIMARY KEY ("partnerId", "userId")
);

ALTER TABLE "PartnerLike" ADD CONSTRAINT "PartnerLike_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerLike" ADD CONSTRAINT "PartnerLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5) Enum lama tidak dipakai lagi
DROP TYPE "PartnerCategory";
