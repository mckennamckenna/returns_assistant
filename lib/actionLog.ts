import { prisma } from "@/lib/db";

interface ActionLogInput {
  userId: string | null;
  orderId: string | null;
  action: string;
  outcome: string;
  ipAddress: string | null;
  userAgent: string | null;
}

const RETRY_DELAY_MS = 200;

// Best-effort with one retry — for ActionLog writes that happen OUTSIDE a
// Prisma transaction (e.g. the already-used-token path in
// app/api/action/archive/route.ts, where the main transaction has already
// rolled back by the time we know the token was already used, so there's
// no transaction left to write inside). Writes inside a transaction don't
// need this: if that write fails, the whole transaction rolls back, which
// is already correct — no partial state to leave an audit gap about.
//
// A silent failure here would mean a real redemption attempt (a second tap
// on an already-used link, say) leaves zero trace. One retry covers a
// transient blip; if it fails twice, tokenHash + orderId + action go to the
// server console so a human can reconstruct what happened — not a perfect
// audit trail, but not a silent gap either.
export async function logActionWithRetry(input: ActionLogInput, tokenHash?: string): Promise<void> {
  try {
    await prisma.actionLog.create({ data: input });
    return;
  } catch (firstError) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    try {
      await prisma.actionLog.create({ data: input });
    } catch (secondError) {
      console.error("ActionLog write failed twice — manual reconstruction needed:", {
        ...input,
        tokenHash,
        firstError,
        secondError,
      });
    }
  }
}
