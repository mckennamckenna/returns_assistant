-- CreateEnum
CREATE TYPE "ReturnUrlReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReturnUrlCandidateSource" AS ENUM ('SEARCH', 'EXTRACTION_FALLBACK', 'MANUAL');

-- CreateTable
CREATE TABLE "ReturnUrlReview" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "rawRetailer" TEXT NOT NULL,
    "approvedRetailer" TEXT,
    "queryUsed" TEXT NOT NULL,
    "candidateUrl" TEXT,
    "alternativeUrls" JSONB,
    "candidateSource" "ReturnUrlCandidateSource" NOT NULL DEFAULT 'SEARCH',
    "status" "ReturnUrlReviewStatus" NOT NULL DEFAULT 'PENDING',
    "approvedUrl" TEXT,
    "sheetRowId" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ReturnUrlReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReturnUrlReview_orderId_key" ON "ReturnUrlReview"("orderId");

-- CreateIndex
CREATE INDEX "ReturnUrlReview_status_idx" ON "ReturnUrlReview"("status");

-- AddForeignKey
ALTER TABLE "ReturnUrlReview" ADD CONSTRAINT "ReturnUrlReview_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
