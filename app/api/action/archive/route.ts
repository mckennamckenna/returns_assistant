import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { verifyToken, verifyCsrfToken } from "@/lib/actionToken";
import { decideArchiveOutcome } from "@/lib/archiveAction";
import { logActionWithRetry } from "@/lib/actionLog";

const ACTION = "archive";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// x-vercel-forwarded-for is set by Vercel's own edge network on every
// request that reaches this function, and — unlike x-forwarded-for —
// can't be altered by an intermediate rewrite or middleware step. Using it
// here rather than x-forwarded-for is deliberate, not a stylistic choice.
function getClientIp(request: NextRequest): string | null {
  return request.headers.get("x-vercel-forwarded-for");
}

// Post/Redirect/Get: a real HTML form submit expects a redirect back to a
// page, not raw JSON — 303 specifically, so a refresh on the done page
// re-does a GET, never resubmits this POST. The done page
// (app/action/archive/done/page.tsx) is purely a display concern reading
// this outcome back out of the query string; nothing about the decision
// logic below changes because of this.
function redirectToOutcome(request: NextRequest, outcome: string): NextResponse {
  const url = new URL("/action/archive/done", request.url);
  url.searchParams.set("outcome", outcome);
  return NextResponse.redirect(url, 303);
}

// Confirmation pages require an actual form submit (POST), never a GET —
// an email client's link-previewer following a GET link must not be able
// to redeem a token by itself. This endpoint has no GET handler at all.
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent");

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return redirectToOutcome(request, "invalid");
  }

  const token = formData.get("token");
  const csrf = formData.get("csrf");

  if (typeof token !== "string" || typeof csrf !== "string") {
    await logActionWithRetry({
      userId: null,
      orderId: null,
      action: ACTION,
      outcome: "invalid",
      ipAddress: ip,
      userAgent,
    });
    return redirectToOutcome(request, "invalid");
  }

  const verified = verifyToken(token, { action: ACTION });

  if (!verified.valid) {
    const payload = verified.reason === "expired" ? verified.payload : null;
    await logActionWithRetry(
      {
        userId: payload?.userId ?? null,
        orderId: payload?.orderId ?? null,
        action: ACTION,
        outcome: verified.reason,
        ipAddress: ip,
        userAgent,
      },
      hashToken(token),
    );
    return redirectToOutcome(request, verified.reason);
  }

  const { payload } = verified;

  if (!verifyCsrfToken(token, csrf)) {
    await logActionWithRetry(
      {
        userId: payload.userId,
        orderId: payload.orderId,
        action: ACTION,
        outcome: "invalid",
        ipAddress: ip,
        userAgent,
      },
      hashToken(token),
    );
    return redirectToOutcome(request, "invalid");
  }

  const tokenHash = hashToken(token);

  // TokenRedemption + (conditionally) Order.update + ActionLog all commit
  // or roll back together — no window where one write lands without the
  // others. TokenRedemption is created FIRST specifically so its unique
  // constraint on tokenHash is what enforces single-use atomically: two
  // concurrent requests for the same token race on this insert, and only
  // one can win it.
  //
  // NOTE for future readers: the outcome is fully decided by the time this
  // function returns. Changing how the outcome is DISPLAYED (redirect
  // target, copy, etc.) must never re-call verifyToken or re-run this
  // transaction — that would double-write ActionLog for a single real
  // redemption attempt.
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.tokenRedemption.create({
        data: { tokenHash, action: ACTION, orderId: payload.orderId },
      });

      const order = await tx.order.findUnique({ where: { id: payload.orderId } });
      const decision = decideArchiveOutcome(order, { userId: payload.userId });

      if (decision.shouldArchive) {
        await tx.order.update({ where: { id: payload.orderId }, data: { archivedAt: new Date() } });
      }

      await tx.actionLog.create({
        data: {
          userId: payload.userId,
          orderId: payload.orderId,
          action: ACTION,
          outcome: decision.outcome,
          ipAddress: ip,
          userAgent,
        },
      });

      return decision.outcome;
    });

    return redirectToOutcome(request, outcome);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // The transaction above rolled back entirely — nothing else was
      // written, so this standalone write is the only record of this
      // attempt. Retried once; see lib/actionLog.ts for why.
      await logActionWithRetry(
        {
          userId: payload.userId,
          orderId: payload.orderId,
          action: ACTION,
          outcome: "already_used",
          ipAddress: ip,
          userAgent,
        },
        tokenHash,
      );
      return redirectToOutcome(request, "already_used");
    }
    throw error;
  }
}
