-- AlterTable
ALTER TABLE "Email" ADD COLUMN     "lineItems" JSONB,
ADD COLUMN     "orderCurrency" TEXT,
ADD COLUMN     "orderTotal" DOUBLE PRECISION;
