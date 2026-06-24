// One-time migration: encrypts fromEmail, fromName, textBody, htmlBody, and
// rawJson on every existing Email row written before encryption-at-rest
// existed. Safe to re-run — rows that already look encrypted are skipped,
// so running this twice does not double-encrypt (which would corrupt them).
//
// Usage: node --env-file=.env ./node_modules/.bin/tsx scripts/encrypt-existing-emails.ts

import { PrismaClient } from "@prisma/client";
import { encrypt } from "../lib/crypto";

const prisma = new PrismaClient();

// Matches our "iv:authTag:ciphertext" format exactly: 12-byte IV (24 hex
// chars), 16-byte auth tag (32 hex chars), then any amount of hex.
const ENCRYPTED_FORMAT = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]*$/i;

function isAlreadyEncrypted(value: string): boolean {
  return ENCRYPTED_FORMAT.test(value);
}

function encryptIfNeeded(value: string): string {
  return isAlreadyEncrypted(value) ? value : encrypt(value);
}

function encryptNullableIfNeeded(value: string | null): string | null {
  if (value == null) return null;
  return encryptIfNeeded(value);
}

async function main() {
  const emails = await prisma.email.findMany();
  console.log(`Found ${emails.length} email rows.`);

  let updated = 0;
  let skipped = 0;

  for (const email of emails) {
    const alreadyDone =
      isAlreadyEncrypted(email.fromEmail) &&
      (email.fromName == null || isAlreadyEncrypted(email.fromName)) &&
      (email.textBody == null || isAlreadyEncrypted(email.textBody)) &&
      (email.htmlBody == null || isAlreadyEncrypted(email.htmlBody)) &&
      isAlreadyEncrypted(email.rawJson);

    if (alreadyDone) {
      skipped++;
      continue;
    }

    await prisma.email.update({
      where: { id: email.id },
      data: {
        fromEmail: encryptIfNeeded(email.fromEmail),
        fromName: encryptNullableIfNeeded(email.fromName),
        textBody: encryptNullableIfNeeded(email.textBody),
        htmlBody: encryptNullableIfNeeded(email.htmlBody),
        rawJson: encryptIfNeeded(email.rawJson),
      },
    });
    updated++;
  }

  console.log(`Encrypted ${updated} rows, skipped ${skipped} already-encrypted rows.`);
}

main()
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
