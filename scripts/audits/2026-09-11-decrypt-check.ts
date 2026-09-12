// Local-only decrypt inspection (no Anthropic calls, no network) —
// TASKS.md pickup-order anomaly diagnostic, Trace 3 support.
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../../lib/crypto";
const prisma = new PrismaClient();
async function main() {
  const ids = ["cmtrni73r000mw96wr7nd2c40", "cmts5z5v7005aw9hvjr4uzyed"];
  for (const id of ids) {
    const e = await prisma.email.findUnique({ where: { id } });
    if (!e) continue;
    console.log(`\n=== ${id} — ${e.subject} ===`);
    const text = e.textBody ? decrypt(e.textBody) : null;
    const html = e.htmlBody ? decrypt(e.htmlBody) : null;
    console.log(`textBody length: ${text?.length ?? 0}`);
    console.log(`htmlBody length: ${html?.length ?? 0}`);
    console.log(`textBody preview (first 800 chars):\n${(text ?? "(none)").slice(0, 800)}`);
    console.log(`\nhtmlBody preview (first 800 chars):\n${(html ?? "(none)").slice(0, 800)}`);
  }
}
main().finally(() => prisma.$disconnect());
