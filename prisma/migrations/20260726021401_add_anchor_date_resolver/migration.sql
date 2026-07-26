-- AlterTable
ALTER TABLE "Email" ADD COLUMN     "anchorDate" TIMESTAMP(3),
ADD COLUMN     "anchorSource" TEXT,
ADD COLUMN     "forwardType" TEXT;
