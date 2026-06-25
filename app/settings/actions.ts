"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

export async function deleteAllData(): Promise<void> {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userId = session.user.id;

  // Dependency order: Reminder references Order, Email references Order.
  // Reminder has no direct userId — scope it through the Order relation.
  await prisma.reminder.deleteMany({ where: { order: { userId } } });
  await prisma.email.deleteMany({ where: { userId } });
  await prisma.order.deleteMany({ where: { userId } });

  redirect("/");
}
