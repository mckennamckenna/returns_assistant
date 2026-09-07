-- CreateTable
CREATE TABLE "DryRunCache" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "isCommerce" BOOLEAN NOT NULL,
    "extractionResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DryRunCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DryRunCache_messageId_key" ON "DryRunCache"("messageId");
