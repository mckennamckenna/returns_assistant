-- AlterTable
ALTER TABLE "Email" ADD COLUMN     "orderId" TEXT;

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "retailer" TEXT,
    "orderNumber" TEXT,
    "orderDate" TIMESTAMP(3),
    "deliveryDate" TIMESTAMP(3),
    "returnDeadline" TIMESTAMP(3),
    "deadlineIsEstimated" BOOLEAN NOT NULL DEFAULT false,
    "policySource" TEXT,
    "returnWindowDays" INTEGER,
    "orderTotal" DOUBLE PRECISION,
    "orderCurrency" TEXT,
    "lineItems" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ordered',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
