// Read-only diagnostic: bound the emailType:null extraction-failure burst
// (TASKS.md Bugs -> Trust-breaking, "Friday weekly coverage-check digest
// badly broken" defect 1 follow-up). No writes, no model calls — pure
// Prisma read + local decrypt() of fromEmail (AES, no network/API call).
import { PrismaClient } from "@prisma/client";
import { createDecipheriv } from "crypto";

const prisma = new PrismaClient();

function decrypt(text) {
  if (!text) return null;
  const parts = text.split(":");
  if (parts.length !== 3) return text;
  const [ivHex, authTagHex, cipherHex] = parts;
  const key = Buffer.from(process.env.ENCRYPTION_KEY, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const cipher = createDecipheriv("aes-256-gcm", key, iv);
  cipher.setAuthTag(authTag);
  const dec = Buffer.concat([cipher.update(Buffer.from(cipherHex, "hex")), cipher.final()]);
  return dec.toString("utf8");
}

function domainOf(email) {
  const at = email.lastIndexOf("@");
  return at === -1 ? email : email.slice(at + 1);
}

async function main() {
  const start = new Date("2026-07-18T00:00:00Z");
  const end = new Date("2026-07-22T00:00:00Z");

  const rows = await prisma.email.findMany({
    where: { receivedAt: { gte: start, lt: end } },
    select: { id: true, receivedAt: true, emailType: true, fromEmail: true, fromName: true, subject: true, userId: true },
    orderBy: { receivedAt: "asc" },
  });

  console.log(`=== ${rows.length} email row(s) between ${start.toISOString()} and ${end.toISOString()} ===\n`);

  let lastCleanBeforeBurst = null;
  let firstCleanAfterBurst = null;
  let inBurst = false;
  let burstStarted = false;
  let burstEnded = false;

  const sequence = [];
  for (const r of rows) {
    let fromDomain = "(decrypt failed)";
    try {
      fromDomain = domainOf(decrypt(r.fromEmail));
    } catch {
      // leave as decrypt-failed marker; not a finding, just a display fallback
    }
    const isNull = r.emailType === null;
    sequence.push({ ...r, fromDomain, isNull });
  }

  for (const r of sequence) {
    const label = r.isNull ? "NULL" : r.emailType;
    console.log(
      `${r.receivedAt.toISOString()}  [${label.padEnd(20)}]  from=${r.fromDomain.padEnd(28)}  subject="${(r.subject ?? "").slice(0, 70)}"`
    );
  }

  // Find the burst boundaries: scan for the first NULL and last NULL in the
  // window, then report the clean rows immediately adjacent on each side,
  // plus the raw edge sequence (not just a boolean) so clean-vs-ragged is
  // visible rather than asserted.
  const firstNullIdx = sequence.findIndex((r) => r.isNull);
  const lastNullIdx = sequence.length - 1 - [...sequence].reverse().findIndex((r) => r.isNull);

  console.log("\n=== Bookends ===");
  if (firstNullIdx === -1) {
    console.log("No NULL rows found in this window at all.");
  } else {
    const beforeIdx = firstNullIdx - 1;
    const afterIdx = lastNullIdx + 1;
    const lastClean = beforeIdx >= 0 ? sequence[beforeIdx] : null;
    const firstCleanAfter = afterIdx < sequence.length ? sequence[afterIdx] : null;

    console.log(`Last clean (non-null) row BEFORE first NULL: ${lastClean ? lastClean.receivedAt.toISOString() + " emailType=" + lastClean.emailType : "(none in window — NULL starts at window start)"}`);
    console.log(`First NULL row: ${sequence[firstNullIdx].receivedAt.toISOString()}`);
    console.log(`Last NULL row: ${sequence[lastNullIdx].receivedAt.toISOString()}`);
    console.log(`First clean (non-null) row AFTER last NULL: ${firstCleanAfter ? firstCleanAfter.receivedAt.toISOString() + " emailType=" + firstCleanAfter.emailType : "(none in window — NULL continues past window end)"}`);

    if (lastClean && firstCleanAfter) {
      const gapMs = firstCleanAfter.receivedAt.getTime() - lastClean.receivedAt.getTime();
      console.log(`\nMeasured gap between last-clean-before and first-clean-after: ${(gapMs / 1000 / 60).toFixed(1)} minutes (${lastClean.receivedAt.toISOString()} -> ${firstCleanAfter.receivedAt.toISOString()})`);
    }

    console.log("\n=== Edge sequence, START of burst (5 rows before first NULL through 5 rows after) ===");
    const startWindow = sequence.slice(Math.max(0, firstNullIdx - 5), firstNullIdx + 5);
    for (const r of startWindow) console.log(`  ${r.receivedAt.toISOString()}  emailType=${r.isNull ? "NULL" : r.emailType}`);

    console.log("\n=== Edge sequence, END of burst (5 rows before last NULL through 5 rows after) ===");
    const endWindow = sequence.slice(Math.max(0, lastNullIdx - 5), Math.min(sequence.length, lastNullIdx + 6));
    for (const r of endWindow) console.log(`  ${r.receivedAt.toISOString()}  emailType=${r.isNull ? "NULL" : r.emailType}`);
  }

  console.log("\n=== Boundedness check ===");
  const nullCountInWindow = sequence.filter((r) => r.isNull).length;
  console.log(`Total NULL rows in queried window (07-18 to 07-22): ${nullCountInWindow}`);

  console.log("\nDaily NULL-row counts, 07-08 through 07-26 (wider context — is 07-19/20/21 an isolated bump or part of a longer pattern?):");
  const wideStart = new Date("2026-07-08T00:00:00Z");
  const wideEnd = new Date("2026-07-27T00:00:00Z");
  const wideNulls = await prisma.email.findMany({
    where: { emailType: null, receivedAt: { gte: wideStart, lt: wideEnd } },
    select: { receivedAt: true },
  });
  const byDay = new Map();
  for (const r of wideNulls) {
    const day = r.receivedAt.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  for (let d = new Date(wideStart); d < wideEnd; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    console.log(`  ${day}: ${byDay.get(day) ?? 0}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
