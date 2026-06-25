// One-time migration: creates a User for the existing single-account-holder
// (using REMINDER_EMAIL, the address that's received reminders so far) and
// attaches every pre-auth Email/Order row to that User. Safe to re-run —
// finds-or-creates the User by email, and only backfills rows that are
// still unowned.
//
// Usage: node --env-file=.env ./node_modules/.bin/tsx scripts/backfill-owner-user.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const ownerEmail = process.env.REMINDER_EMAIL;
  if (!ownerEmail) {
    throw new Error("REMINDER_EMAIL is not set — needed to know which email owns the existing data");
  }

  const user = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {},
    create: { email: ownerEmail },
  });

  console.log(`Owner user: ${user.email} (id ${user.id}, inboundToken ${user.inboundToken})`);

  const emails = await prisma.email.updateMany({
    where: { userId: null },
    data: { userId: user.id },
  });
  const orders = await prisma.order.updateMany({
    where: { userId: null },
    data: { userId: user.id },
  });

  console.log(`Backfilled ${emails.count} email rows and ${orders.count} order rows.`);
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
