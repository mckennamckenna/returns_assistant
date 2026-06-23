-- AlterTable
ALTER TABLE "Email" ADD COLUMN     "deadlineIsEstimated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailType" TEXT;
