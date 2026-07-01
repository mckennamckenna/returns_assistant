import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ALLOWED_MANUAL_STATUSES, DISPLAY_STATUS_RANK } from "@/lib/displayStatus";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

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
    return NextResponse.json(
      { error: `status must be one of: ${ALLOWED_MANUAL_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  const order = await prisma.order.findUnique({
    where: { id },
    select: { userId: true, displayStatus: true, returnedAt: true },
  });

  if (!order || order.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const currentRank = DISPLAY_STATUS_RANK[order.displayStatus] ?? 0;
  const newRank = DISPLAY_STATUS_RANK[status] ?? 0;

  if (newRank <= currentRank) {
    return NextResponse.json(
      { error: "Cannot downgrade displayStatus" },
      { status: 400 },
    );
  }

  const data: { displayStatus: string; returnedAt?: Date } = { displayStatus: status };
  if (status === "returned" && !order.returnedAt) {
    data.returnedAt = new Date();
  }

  const updated = await prisma.order.update({
    where: { id },
    data,
    select: { displayStatus: true },
  });

  return NextResponse.json({ displayStatus: updated.displayStatus });
}
