"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

export async function deleteAllData(): Promise<void> {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userId = session.user.id;

  // Dependency order: Reminder references Order, Email references Order.
  // Reminder now has a direct userId (Milestone 16, for the per-user
  // weekly coverage check, which has no order at all) — delete by that
  // directly rather than through the order relation, which would miss
  // exactly those rows.
  await prisma.reminder.deleteMany({ where: { userId } });
  await prisma.email.deleteMany({ where: { userId } });
  await prisma.order.deleteMany({ where: { userId } });

  redirect("/");
}
