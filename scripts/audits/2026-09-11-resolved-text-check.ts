// Local-only: reproduce exactly what isCommerceEmail's 8000-char window
// would have seen for the two stored Crate & Barrel / Shutterfly bodies.
// No Anthropic calls.
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../../lib/crypto";
import { resolveBodyText } from "../../lib/emailBodyText";

const prisma = new PrismaClient();

async function main() {
  const ids = ["cmtrni73r000mw96wr7nd2c40", "cmts5z5v7005aw9hvjr4uzyed"];
  for (const id of ids) {
    const e = await prisma.email.findUnique({ where: { id } });
    if (!e) continue;
    const text = e.textBody ? decrypt(e.textBody) : null;
    const html = e.htmlBody ? decrypt(e.htmlBody) : null;
    const resolved = resolveBodyText(text, html);
    const classifierWindow = resolved ? resolved.slice(0, 8000) : "";
    console.log(`\n=== ${id} — ${e.subject} ===`);
    console.log(`resolved length: ${resolved?.length ?? 0} | classifier window: ${classifierWindow.length}`);
    console.log(`Order-identifying tokens present in classifier window?`);
    for (const needle of ["Order Number", "order confirmation", "Ready for Pickup", "Pickup", "received your", "$", "Qty"]) {
      console.log(`  "${needle}": ${classifierWindow.includes(needle)}`);
    }
    console.log(`\n--- classifier window, chars 0-1500 ---\n${classifierWindow.slice(0, 1500)}`);
    console.log(`\n--- classifier window, LAST 1500 chars (near truncation point) ---\n${classifierWindow.slice(-1500)}`);
  }
}
main().finally(() => prisma.$disconnect());
