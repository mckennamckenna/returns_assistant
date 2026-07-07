-- AlterTable
ALTER TABLE "User" ADD COLUMN     "gmailVerificationCode" TEXT,
ADD COLUMN     "gmailVerificationCodeReceivedAt" TIMESTAMP(3);
