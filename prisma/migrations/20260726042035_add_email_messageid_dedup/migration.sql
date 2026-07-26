-- AlterTable
ALTER TABLE "Email" ADD COLUMN     "messageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Email_userId_messageId_key" ON "Email"("userId", "messageId");
