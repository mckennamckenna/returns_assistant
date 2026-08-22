/**
 * scripts/pm-diag-orderdate-provenance.ts
 *
 * READ-ONLY diagnostic. 0 billed Anthropic calls (no model path is touched),
 * 0 DB writes (findMany/findFirst only). Safe to run against production.
 *
 * Purpose (before any fix is written):
 *   1. Settle J.Crew #2522877374's provenance: is its stored orderDate null,
 *      overwritten-to-recent by a non-establishing email, or intact? The board's
 *      08-14 entry claims "no order_confirmation ever linked, orderDate correctly
 *      null" — the "Kept" card contradicts that. This prints the ground truth.
 *   2. Same dump for Suzie's row.
 *   3. Population scan: how many orders have an orderDate that looks set/overwritten
 *      by a refund/return_label/other email (the mergeEmailIntoOrder bug), and is
 *      the true date recoverable from an earlier establishing email? (Sizes the backfill.)
 *   4. Cosmetic corroboration: duplicated auto-notes / >1 linked return_label
 *      (would corroborate a double-merge, i.e. double overwrite).
 *
 * Run: npx tsx scripts/pm-diag-orderdate-provenance.ts
 *      (or ts-node, per your usual one-off convention)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ASSUMPTIONS — field/relation names reconciled against schema.prisma
 * 2026-08-16: all names below confirmed correct as originally written, no
 * changes needed. Logic and the establishing/non-establishing type sets are
 * unchanged from the original draft.
 *   Order.orderDate            (DateTime?)   Order.orderDateEstimated (Boolean)
 *   Order.createdAt            (DateTime)    Order.status             (String)
 *   Order.retailer / orderNumber (String)    Order.keptAt            (DateTime?)
 *   Order.userNote             (String?)     Order.userId            (String)
 *   Order.emails               (Email[] reverse relation)
 *   Email.emailType            (String?)     Email.orderDate          (DateTime?)  // AI-extracted, per-email
 *   Email.receivedAt           (DateTime)    Email.extractedAt        (DateTime?)  Email.orderId (String?)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * OWNERSHIP SCOPING — added 2026-08-16, not part of the original draft's
 * logic: both Part A (named targets) and Part B/C (population scan) are
 * scoped to a single resolved userId, per this run's "ownership-scoped to
 * me" instruction. OWNER_EMAIL below is the only thing that changes between
 * runs; the userId is resolved from it at runtime, never hardcoded.
 */

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Only these may legitimately ESTABLISH an orderDate. Mirrors ALLOWED_FALLBACK_EMAIL_TYPES.
const ESTABLISHING = new Set(["order_confirmation", "shipping_confirmation", "delivery"]);
// These should never have set/overwritten orderDate. `null`/unknown types treated as non-establishing.
const NON_ESTABLISHING = new Set(["refund", "return_label", "other"]);

// Whose data this run is scoped to — resolved to a userId at runtime.
const OWNER_EMAIL = "mckenna.sweazey@gmail.com";

// Named targets for the deep dump.
const TARGETS = [
  { retailer: "J.Crew", orderNumber: "2522877374" },
  { retailer: "Suzie Kondi", orderNumber: null as string | null },
];

type EmailLite = {
  id: string;
  emailType: string | null;
  orderDate: Date | null;
  receivedAt: Date;
  extractedAt: Date | null;
};

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");
const sortByReceived = (es: EmailLite[]) =>
  [...es].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());

function dumpOrder(label: string, o: any) {
  const emails: EmailLite[] = sortByReceived(o.emails ?? []);
  console.log(`\n=== ${label} — ${o.retailer} #${o.orderNumber} (id ${o.id}) ===`);
  console.log({
    stored_orderDate: day(o.orderDate),
    orderDateEstimated: o.orderDateEstimated,
    status: o.status,
    keptAt: day(o.keptAt),
    createdAt: day(o.createdAt),
    userNote_dupe: hasDuplicatedNote(o.userNote),
  });
  console.table(
    emails.map((e) => ({
      type: e.emailType ?? "null",
      establishing: ESTABLISHING.has(e.emailType ?? "") ? "yes" : "no",
      extracted_orderDate: day(e.orderDate),
      receivedAt: day(e.receivedAt),
      extractedAt: day(e.extractedAt),
    }))
  );
  const verdict = classify(o.orderDate, o.orderDateEstimated, emails);
  console.log(`  → provenance verdict: ${verdict.tag}${verdict.note ? "  (" + verdict.note + ")" : ""}`);
  if (verdict.recoverableTo) console.log(`  → true date recoverable from establishing email: ${verdict.recoverableTo}`);
}

function hasDuplicatedNote(note: string | null): boolean {
  if (!note) return false;
  // crude: same "[auto] ... resurfaced for review" clause appearing twice
  const clause = note.match(/\[auto\][^[]*resurfaced for review/i)?.[0];
  return !!clause && note.indexOf(clause) !== note.lastIndexOf(clause);
}

/**
 * Provenance classifier. The bug's fingerprint: stored orderDate == the extracted
 * orderDate of a NON-establishing email, while an ESTABLISHING email carries a
 * different (earlier) date that got clobbered.
 */
function classify(
  stored: Date | null,
  estimated: boolean,
  emails: EmailLite[]
): { tag: string; note?: string; recoverableTo?: string } {
  if (!stored) return { tag: "NULL_ORDERDATE", note: "no stored date — genuine orphan or fallback stayed null" };

  const storedKey = day(stored);
  const est = sortByReceived(emails.filter((e) => ESTABLISHING.has(e.emailType ?? "") && e.orderDate));
  const nonEst = emails.filter((e) => NON_ESTABLISHING.has(e.emailType ?? "") && e.orderDate);

  const earliestEst = est[0]?.orderDate ?? null;
  const matchesNonEst = nonEst.some((e) => day(e.orderDate) === storedKey);
  const matchesEst = est.some((e) => day(e.orderDate) === storedKey);

  if (matchesNonEst && earliestEst && day(earliestEst) !== storedKey) {
    return {
      tag: "CORRUPTED_RECOVERABLE",
      note: `stored date == a ${nonEst.find((e) => day(e.orderDate) === storedKey)?.emailType} email; establishing email has an earlier date`,
      recoverableTo: day(earliestEst),
    };
  }
  if (matchesNonEst && !earliestEst) {
    return {
      tag: "CORRUPTED_UNRECOVERABLE",
      note: "stored date == a non-establishing email; no establishing email with a date exists to restore from",
    };
  }
  if (matchesNonEst && matchesEst) {
    return { tag: "SUSPICIOUS_AMBIGUOUS", note: "stored date matches both an establishing and a non-establishing email; eyeball it" };
  }
  if (matchesEst) return { tag: "OK_FROM_ESTABLISHING" };
  return { tag: "UNKNOWN_SOURCE", note: "stored date matches no linked email's extracted date; came from fallback/receivedAt or manual" };
}

async function main() {
  console.log("READ-ONLY orderDate provenance diagnostic — 0 model calls, 0 writes.\n");

  const owner = await prisma.user.findFirst({ where: { email: OWNER_EMAIL } });
  if (!owner) {
    console.log(`!! owner not found for ${OWNER_EMAIL} — aborting.`);
    return;
  }
  const OWNER_USER_ID = owner.id;
  // Explicit opt-in only — default stays owner-scoped. Part B/C population
  // scan sizing needs one unscoped run since mergeEmailIntoOrder is shared
  // across all users, not owner-specific; Part A (named targets) stays
  // scoped to this owner regardless, since those are this owner's orders.
  const ALL_USERS = process.argv.includes("--all-users");
  console.log(`Part A scoped to userId=${OWNER_USER_ID} (${OWNER_EMAIL})`);
  console.log(`Part B/C population scan scope: ${ALL_USERS ? "ALL USERS (unscoped, --all-users)" : `owner-only (${OWNER_EMAIL})`}\n`);

  // ── Part A: the two named orders ────────────────────────────────────────────
  for (const t of TARGETS) {
    const o = await prisma.order.findFirst({
      where: {
        userId: OWNER_USER_ID,
        retailer: { contains: t.retailer, mode: "insensitive" },
        ...(t.orderNumber ? { orderNumber: t.orderNumber } : {}),
      },
      include: { emails: true },
    });
    if (!o) {
      console.log(`\n!! not found (within this owner's data): ${t.retailer} ${t.orderNumber ?? ""}`);
      continue;
    }
    dumpOrder("TARGET", o);
  }

  // ── Part B + C: population scan (corruption count + recoverability) ──────────
  const all = await prisma.order.findMany({
    where: {
      orderDate: { not: null },
      ...(ALL_USERS ? {} : { userId: OWNER_USER_ID }),
    },
    include: { emails: true },
  });

  const buckets: Record<string, any[]> = {
    CORRUPTED_RECOVERABLE: [],
    CORRUPTED_UNRECOVERABLE: [],
    SUSPICIOUS_AMBIGUOUS: [],
  };

  for (const o of all) {
    const v = classify(o.orderDate, o.orderDateEstimated, sortByReceived(o.emails));
    if (buckets[v.tag]) {
      buckets[v.tag].push({
        id: o.id,
        order: `${o.retailer} #${o.orderNumber}`,
        stored: day(o.orderDate),
        estimated: o.orderDateEstimated,
        status: o.status,
        recoverableTo: v.recoverableTo ?? "—",
      });
    }
  }

  console.log(`\n\n========== POPULATION SCAN (orders with non-null orderDate, ${ALL_USERS ? "ALL USERS" : "this owner"}: ${all.length}) ==========`);
  for (const [tag, rows] of Object.entries(buckets)) {
    console.log(`\n${tag}: ${rows.length}`);
    if (rows.length) console.table(rows);
  }

  // ── Part D: double-merge corroboration ──────────────────────────────────────
  const doubles = all
    .map((o) => ({
      order: `${o.retailer} #${o.orderNumber}`,
      return_label_count: o.emails.filter((e: any) => e.emailType === "return_label").length,
      note_duplicated: hasDuplicatedNote(o.userNote),
    }))
    .filter((r) => r.return_label_count > 1 || r.note_duplicated);
  console.log(`\n\n========== DOUBLE-MERGE / DUPLICATE-NOTE corroboration (${doubles.length}) ==========`);
  if (doubles.length) console.table(doubles);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n\n========== BACKFILL SIZING ==========`);
  console.log(`recoverable (safe silent restore): ${buckets.CORRUPTED_RECOVERABLE.length}`);
  console.log(`unrecoverable (needs a call — true date is gone): ${buckets.CORRUPTED_UNRECOVERABLE.length}`);
  console.log(`ambiguous (manual eyeball): ${buckets.SUSPICIOUS_AMBIGUOUS.length}`);
  console.log(`\nbilled Anthropic calls this run: 0 · DB writes: 0`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
