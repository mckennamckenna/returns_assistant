"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function deleteAllData(): Promise<void> {
  // Dependency order: Reminder references Order, Email references Order.
  await prisma.reminder.deleteMany({});
  await prisma.email.deleteMany({});
  await prisma.order.deleteMany({});

  redirect("/");
}
