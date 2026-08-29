-- Ecosystem partner directory: model Partner + enum PartnerCategory + optional Quest.partnerId.
-- Partner murni off-chain (tidak menyentuh DAML); Quest lama tanpa partner tetap aman.

CREATE TYPE "PartnerCategory" AS ENUM ('COMPLIANCE', 'CUSTODY', 'DATA_ANALYTICS', 'DEVELOPER_TOOLS', 'EXCHANGES', 'FINANCING', 'FORENSICS_SECURITY', 'INTEROPERABILITY', 'LIQUIDITY', 'NAAS', 'PAYMENTS', 'STABLECOINS', 'TOKENIZED_ASSETS', 'WALLETS');

CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "logoUrl" TEXT,
    "category" "PartnerCategory" NOT NULL,
    "about" TEXT NOT NULL DEFAULT '',
    "website" TEXT,
    "socialLinks" TEXT NOT NULL DEFAULT '[]',
    "team" TEXT NOT NULL DEFAULT '[]',
    "features" TEXT NOT NULL DEFAULT '[]',
    "appsFeatured" TEXT NOT NULL DEFAULT '[]',
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Quest" ADD COLUMN "partnerId" TEXT;

ALTER TABLE "Quest" ADD CONSTRAINT "Quest_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Quest_partnerId_idx" ON "Quest"("partnerId");
