-- Ecosystem: kategori jadi tabel admin-managed + fitur like partner.
-- Idempotent (IF NOT EXISTS) — aman dijalankan ulang setelah kegagalan parsial.

-- 1) Partner.category: enum -> String (nilai tetap, kini referensi EcosystemCategory.value)
ALTER TABLE "Partner" ALTER COLUMN "category" TYPE TEXT;

-- 2) Like counter (denormalized; baris PartnerLike menjaga kejujurannya)
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "likes" INTEGER NOT NULL DEFAULT 0;

-- 3) Tabel kategori ecosystem (seed 14 kategori bawaan)
CREATE TABLE IF NOT EXISTS "EcosystemCategory" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EcosystemCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EcosystemCategory_value_key" ON "EcosystemCategory"("value");

INSERT INTO "EcosystemCategory" ("id", "value", "label", "sortOrder", "updatedAt")
SELECT replace(gen_random_uuid()::text, '-', ''), v.value, v.label, v.sortOrder, CURRENT_TIMESTAMP
FROM (VALUES
  ('COMPLIANCE',         'Compliance', 1),
  ('CUSTODY',            'Custody', 2),
  ('DATA_ANALYTICS',     'Data & Analytics', 3),
  ('DEVELOPER_TOOLS',    'Developer Tools', 4),
  ('EXCHANGES',          'Exchanges', 5),
  ('FINANCING',          'Financing', 6),
  ('FORENSICS_SECURITY', 'Forensics & Security', 7),
  ('INTEROPERABILITY',   'Interoperability', 8),
  ('LIQUIDITY',          'Liquidity', 9),
  ('NAAS',               'NaaS', 10),
  ('PAYMENTS',           'Payments', 11),
  ('STABLECOINS',        'Stablecoins', 12),
  ('TOKENIZED_ASSETS',   'Tokenized Assets', 13),
  ('WALLETS',            'Wallets', 14)
) AS v(value, label, sortOrder)
WHERE NOT EXISTS (SELECT 1 FROM "EcosystemCategory" ec WHERE ec.value = v.value);

-- 4) Like: satu baris per user per partner
CREATE TABLE IF NOT EXISTS "PartnerLike" (
    "partnerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerLike_pkey" PRIMARY KEY ("partnerId", "userId")
);

-- 5) FK PartnerLike (idempotent via DO block)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PartnerLike_partnerId_fkey') THEN
    ALTER TABLE "PartnerLike" ADD CONSTRAINT "PartnerLike_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PartnerLike_userId_fkey') THEN
    ALTER TABLE "PartnerLike" ADD CONSTRAINT "PartnerLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 6) Enum lama tidak dipakai lagi (drop bila masih ada)
DROP TYPE IF EXISTS "PartnerCategory";
