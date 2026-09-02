-- Ecosystem partner: badge Featured App (toggle admin yes/no).
ALTER TABLE "Partner" ADD COLUMN "featuredApp" BOOLEAN NOT NULL DEFAULT false;
