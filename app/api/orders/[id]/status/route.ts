import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ALLOWED_MANUAL_STATUSES, decideManualStatusChange } from "@/lib/displayStatus";
import { logActionWithRetry } from "@/lib/actionLog";

// x-vercel-forwarded-for mirrors app/api/action/returned/route.ts's
// getClientIp — set by Vercel's edge network, can't be spoofed via an
// intermediate rewrite, unlike x-forwarded-for.
function getClientIp(req: NextRequest): string | null {
  return req.headers.get("x-vercel-forwarded-for");
}

// Logs every call to ActionLog (action "status_patch:<from>-><to>") — see
// the model comment in prisma/schema.prisma for the full convention and
// outcome taxonomy. Added 2026-09-04: this was previously a silent no-op/
// unlogged error response on every non-success branch.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ipAddress = getClientIp(req);
  const userAgent = req.headers.get("user-agent");

  const session = await auth();
  if (!session?.user) {
    await logActionWithRetry({
      userId: null,
      orderId: id,
      action: "status_patch:unknown->unknown",
      outcome: "unauthenticated",
      ipAddress,
      userAgent,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const status = (body as Record<string, unknown>)?.status;
  if (
    typeof status !== "string" ||
    !(ALLOWED_MANUAL_STATUSES as readonly string[]).includes(status)
  ) {
    await logActionWithRetry({
      userId,
      orderId: id,
      action: `status_patch:unknown->${typeof status === "string" ? status : "invalid"}`,
      outcome: "invalid_status",
      ipAddress,
      userAgent,
    });
    return NextResponse.json(
      { error: `status must be one of: ${ALLOWED_MANUAL_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        select: { userId: true, displayStatus: true, returnedAt: true, archivedAt: true, keptAt: true },
      });

      const decision = decideManualStatusChange(order, userId, status);
      const action = `status_patch:${decision.fromStatus}->${status}`;

      let updated: { displayStatus: string; archivedAt: Date | null } | null = null;
      if (decision.outcome === "success" && decision.data) {
        updated = await tx.order.update({
          where: { id },
          data: decision.data,
          select: { displayStatus: true, archivedAt: true },
        });
      }

      await tx.actionLog.create({
        data: { userId, orderId: id, action, outcome: decision.outcome, ipAddress, userAgent },
      });

      return { outcome: decision.outcome, updated };
    });

    if (result.outcome === "not_found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (result.outcome === "noop_already_at_status") {
      return NextResponse.json({ error: "Cannot downgrade displayStatus" }, { status: 400 });
    }

    return NextResponse.json({ displayStatus: result.updated!.displayStatus, archivedAt: result.updated!.archivedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logActionWithRetry({
      userId,
      orderId: id,
      action: `status_patch:unknown->${status}:error:${message.slice(0, 200)}`,
      outcome: "exception",
      ipAddress,
      userAgent,
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
