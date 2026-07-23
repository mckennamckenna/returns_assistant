-- AlterTable
ALTER TABLE "Email" ADD COLUMN     "junkedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EmailRescue" (
    "id" TEXT NOT NULL,
    "emailId" TEXT,
    "userId" TEXT,
    "rescuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailRescue_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "EmailRescue" ADD CONSTRAINT "EmailRescue_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailRescue" ADD CONSTRAINT "EmailRescue_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
