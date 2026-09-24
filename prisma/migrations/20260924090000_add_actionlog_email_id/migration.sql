-- Extraction recovery sweep (TASKS.md 2026-09-24): give ActionLog a way to
-- name an EMAIL, so "this email has had its one automatic retry" is a
-- durable database fact rather than a log line that ages out in minutes.
--
-- ADDITIVE ONLY, owner-approved on the exact SQL below before writing:
-- one nullable column, one index, one ON DELETE SET NULL foreign key.
-- Nothing can lose data; no existing read changes; every existing row
-- keeps emailId NULL.

-- AlterTable
ALTER TABLE "ActionLog" ADD COLUMN     "emailId" TEXT;

-- CreateIndex
CREATE INDEX "ActionLog_emailId_idx" ON "ActionLog"("emailId");

-- AddForeignKey
ALTER TABLE "ActionLog" ADD CONSTRAINT "ActionLog_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email"("id") ON DELETE SET NULL ON UPDATE CASCADE;
