-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "userNote" TEXT;

-- CreateTable
CREATE TABLE "DiscardLog" (
    "id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscardLog_pkey" PRIMARY KEY ("id")
);
