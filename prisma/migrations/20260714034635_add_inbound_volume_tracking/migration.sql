-- AlterTable
ALTER TABLE "User" ADD COLUMN     "inboundWindowCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "inboundWindowStart" TIMESTAMP(3);
