import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Soft-deletes the order by setting deletedAt = now.
// Hard deletion happens via the nightly cron after HARD_DELETE_DAYS.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    select: { userId: true },
  });

  if (!order || order.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.order.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ deleted: true });
}
