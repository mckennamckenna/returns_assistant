// READ-ONLY diagnostic. Zero writes, zero billed Anthropic calls (no
// extraction, no policy lookup, no classification triggered anywhere in
// this script — only prisma.findMany/findUnique reads and local string
// search). Per exact spec from the owner.
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../lib/crypto";

const prisma = new PrismaClient();
const OWNER_EMAIL = "mckenna.sweazey@gmail.com";

function stripBoilerplate(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findOrderNumberMentions(label: string, raw: string | null) {
  if (!raw) {
    console.log(`  [${label}] — field is empty/null.`);
    return;
  }
  const cleaned = stripBoilerplate(raw);
  console.log(`  [${label}] — cleaned length ${cleaned.length} chars.`);

  // Look for explicit "order" + number patterns, and any standalone
  // 8-12 digit run (H&M order numbers observed elsewhere on this account
  // are 11 digits, e.g. 68462778273) — report every match with context,
  // not just the first.
  const patterns: RegExp[] = [
    /order\s*#?\s*:?\s*\d{6,14}/gi,
    /\b\d{8,14}\b/g,
  ];
  const seen = new Set<string>();
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null) {
      const key = `${m.index}:${m[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const start = Math.max(0, m.index - 50);
      const end = Math.min(cleaned.length, m.index + m[0].length + 50);
      const context = cleaned.slice(start, end);
      const pctThrough = ((m.index / cleaned.length) * 100).toFixed(0);
      const roughLocation = pctThrough < "15" ? "top" : pctThrough > "85" ? "footer" : "middle/table";
      console.log(`    MATCH "${m[0]}" at char ${m.index} (~${pctThrough}% through, roughly "${roughLocation}"): ...${context}...`);
    }
  }
  if (seen.size === 0) {
    console.log(`    No order-number-like pattern found in [${label}].`);
  }
}

async function main() {
  const owner = await prisma.user.findFirst({ where: { email: OWNER_EMAIL } });
  if (!owner) return console.log("Owner not found.");

  console.log("=== STEP 1 — locate the orphaned H&M return_label row(s) ===");
  console.log("Filter: emailType='return_label' AND orderId=NULL AND receivedAt in [2026-08-18, 2026-08-20] AND userId=owner. No retailer filter applied.\n");

  const matches = await prisma.email.findMany({
    where: {
      userId: owner.id,
      emailType: "return_label",
      orderId: null,
      receivedAt: { gte: new Date("2026-08-18T00:00:00.000Z"), lte: new Date("2026-08-20T23:59:59.999Z") },
    },
  });

  console.log(`Rows matching: ${matches.length}\n`);

  if (matches.length === 0) {
    console.log("STOP: no matching row. Nothing further to report.");
    return;
  }
  if (matches.length > 1) {
    console.log("STOP: more than one row matched — reporting all, per instruction, not proceeding to classification.\n");
    for (const e of matches) {
      console.log({
        id: e.id,
        receivedAt: e.receivedAt.toISOString(),
        subject: e.subject,
        fromEmail: e.fromEmail ? decrypt(e.fromEmail) : null,
        orderNumber: e.orderNumber,
        retailer: e.retailer,
        orderId: e.orderId,
      });
    }
    return;
  }

  const e = matches[0];

  console.log("=== STEP 2 — row identity ===");
  console.log({
    "Email.id": e.id,
    receivedAt: e.receivedAt.toISOString(),
    subject: e.subject,
    fromEmail: e.fromEmail ? decrypt(e.fromEmail) : null,
  });

  console.log("\n=== STEP 3 — Email.orderNumber ===");
  console.log(`orderNumber = ${e.orderNumber === null ? "NULL" : `"${e.orderNumber}"`}`);

  console.log("\n=== STEP 4 — Email.retailer ===");
  console.log(`retailer = ${e.retailer === null ? "NULL" : `"${e.retailer}"`}`);

  console.log("\n=== STEP 5 — Email.orderId ===");
  console.log(`orderId = ${e.orderId === null ? "NULL (confirmed)" : `NOT NULL: "${e.orderId}" — contradicts orphan assumption`}`);

  console.log("\n=== STEP 6 — Email.extractionNotes (full text) ===");
  console.log(e.extractionNotes ?? "(null — no extractionNotes stored)");

  if (e.orderNumber === null) {
    console.log("\n=== STEP 7 — orderNumber is NULL. Searching htmlBody AND textBody for order-number-like strings ===");
    const html = e.htmlBody ? decrypt(e.htmlBody) : null;
    const text = e.textBody ? decrypt(e.textBody) : null;
    findOrderNumberMentions("htmlBody", html);
    findOrderNumberMentions("textBody", text);
  } else {
    console.log("\n=== STEP 7 — skipped (orderNumber is populated, not NULL) ===");
  }

  console.log("\n\n=== STEP 8 — the three H&M orders on file for this user (independent sanity check) ===");
  const hmOrders = await prisma.order.findMany({
    where: { userId: owner.id, retailer: { contains: "H&M", mode: "insensitive" } },
    select: {
      orderNumber: true, orderDate: true, orderTotal: true, orderCurrency: true,
      status: true, displayStatus: true, keptAt: true, returnedAt: true,
    },
    orderBy: { orderDate: "asc" },
  });
  for (const o of hmOrders) {
    console.log({
      orderNumber: o.orderNumber,
      orderDate: o.orderDate ? o.orderDate.toISOString() : null,
      total: o.orderTotal,
      currency: o.orderCurrency,
      status: o.status,
      displayStatus: o.displayStatus,
      keptAt: o.keptAt ? o.keptAt.toISOString() : null,
      returnedAt: o.returnedAt ? o.returnedAt.toISOString() : null,
    });
  }

  console.log("\n\n=== STEP 9 — classification ===");
  if (e.orderNumber !== null) {
    console.log("(a) orderNumber IS populated on the row → LINKING BUG. Signal was extracted; lib/linkOrder.ts did not route it to the matching order. 6a-family scope.");
  } else {
    console.log("orderNumber is NULL on the row. Classification (b) vs (c) depends on STEP 7's findings above — read those matches directly, not inferred here.");
    console.log("(b) if STEP 7 shows the order number clearly in body text → EXTRACTION GAP. Prompt or body-normalization dropped a real signal. Fix belongs in lib/extract.ts / body-resolution path.");
    console.log("(c) if STEP 7 shows NO order number in body text → flag and stop, scope changes.");
  }

  console.log("\nbilled Anthropic calls this run: 0 · DB writes: 0 · extraction/policy-lookup/classification calls triggered: 0");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
