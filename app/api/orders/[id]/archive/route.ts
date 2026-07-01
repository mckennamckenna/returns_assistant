import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// PATCH { archived: true }  → sets archivedAt = now (reversible)
// PATCH { archived: false } → clears archivedAt (unarchive)
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

  const archived = (body as Record<string, unknown>)?.archived;
  if (typeof archived !== "boolean") {
    return NextResponse.json({ error: "archived must be a boolean" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id },
    select: { userId: true },
  });

  if (!order || order.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.order.update({
    where: { id },
    data: { archivedAt: archived ? new Date() : null },
    select: { archivedAt: true },
  });

  return NextResponse.json({ archivedAt: updated.archivedAt });
}
