-- AlterTable
ALTER TABLE "Email" ADD COLUMN     "retailerSource" TEXT;

-- Backfill: rows that already have a body-extracted retailer value get
-- retailerSource = 'body_extraction'. Safe in raw SQL because `retailer`
-- is a plain unencrypted column.
UPDATE "Email" SET "retailerSource" = 'body_extraction' WHERE "retailer" IS NOT NULL;

-- Deliberately NOT backfilling 'carrier_deferred' here. Email.fromEmail is
-- encrypted at rest (AES-256-GCM, per-row random IV, key in
-- process.env.ENCRYPTION_KEY) — there is no plaintext for raw SQL to
-- pattern-match against, and no prior migration or script in this repo has
-- ever done so; every existing backfill-*.ts touching fromEmail decrypts it
-- in application code first. The historical carrier-row backfill runs as a
-- companion Prisma script instead: scripts/backfill-carrier-deferred-
-- 20260825.ts, idempotent, dry-run by default, applied separately after
-- this migration.
