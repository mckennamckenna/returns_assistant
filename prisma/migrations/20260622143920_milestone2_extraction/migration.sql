-- AlterTable
ALTER TABLE "Email" ADD COLUMN     "confidence" TEXT,
ADD COLUMN     "deliveryDate" TIMESTAMP(3),
ADD COLUMN     "extractedAt" TIMESTAMP(3),
ADD COLUMN     "extractionNotes" TEXT,
ADD COLUMN     "extractionRaw" JSONB,
ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "orderDate" TIMESTAMP(3),
ADD COLUMN     "orderNumber" TEXT,
ADD COLUMN     "retailer" TEXT,
ADD COLUMN     "returnDeadline" TIMESTAMP(3),
ADD COLUMN     "returnWindowDays" INTEGER;
