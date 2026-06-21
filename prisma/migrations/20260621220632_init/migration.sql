-- CreateTable
CREATE TABLE "Email" (
    "id" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT,
    "toHash" TEXT,
    "subject" TEXT,
    "textBody" TEXT,
    "htmlBody" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawJson" JSONB NOT NULL,

    CONSTRAINT "Email_pkey" PRIMARY KEY ("id")
);
