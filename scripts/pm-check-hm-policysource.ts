// READ-ONLY. Zero billed calls. Verifies the hard-gate question raised in
// TASKS.md 🐛 Bugs → Infra/reliability, "return_label extraction shouldn't
// trigger lookupReturnPolicy...": does Email.policySource actually reflect
// the policy_lookup call confirmed in this session's usage logs, or is the
// production UI's empty "Policy Source" showing something else (e.g. the
// Order-level field, which may differ from this specific Email's own)?
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TARGET_EMAIL_ID = "cmt090ioq0001l404crsih7w9";

async function main() {
  const e = await prisma.email.findUnique({ where: { id: TARGET_EMAIL_ID } });
  if (!e) return console.log("Email row not found.");
  console.log("Email.policySource:", e.policySource);
  console.log("Email.returnWindowDays:", e.returnWindowDays);
  console.log("Email.orderId:", e.orderId);

  if (e.orderId) {
    const order = await prisma.order.findUnique({ where: { id: e.orderId } });
    console.log("Order.policySource:", order?.policySource);
    console.log("Order.returnWindowDays:", order?.returnWindowDays);
    console.log("Order.returnDeadline:", order?.returnDeadline);
  }
  console.log("billed Anthropic calls this run: 0 · DB writes: 0");
}

main().finally(() => prisma.$disconnect());
