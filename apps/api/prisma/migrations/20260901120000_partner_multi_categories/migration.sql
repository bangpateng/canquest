-- Ecosystem partner multi-kategori: kolom categories text[] (primary tetap di `category`).
ALTER TABLE "Partner" ADD COLUMN "categories" TEXT[] NOT NULL DEFAULT '{}';

-- Backfill: kategori lama jadi elemen pertama array.
UPDATE "Partner"
SET "categories" = ARRAY["category"]
WHERE "category" IS NOT NULL AND "category" <> '' AND array_length("categories", 1) IS NULL;
