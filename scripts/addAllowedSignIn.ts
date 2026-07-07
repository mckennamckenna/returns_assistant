// One-off: adds emails to the AllowedSignIn alpha-gating allowlist checked
// in auth.ts before a magic-link email is ever sent.
import { prisma } from "@/lib/db";

const emails = process.argv.slice(2);

if (emails.length === 0) {
  console.error("Usage: npx tsx scripts/addAllowedSignIn.ts <email1> <email2> ...");
  process.exit(1);
}

async function main() {
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    const row = await prisma.allowedSignIn.upsert({
      where: { email },
      update: {},
      create: { email },
    });
    console.log(`allowed: ${row.email}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
