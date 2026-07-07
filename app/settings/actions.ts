"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { gmailVerifiedClearFields } from "@/lib/gmailVerification";

// "I've entered this code in Gmail" — a one-way action from the user's
// perspective (see app/settings/GmailVerificationCode.tsx's button copy):
// once cleared, if they hadn't actually pasted the code into Gmail yet,
// they'll need to trigger a fresh confirmation email to get another one.
export async function markGmailVerified(): Promise<void> {
  const session = await auth();
  if (!session?.user) redirect("/login");

  await prisma.user.update({
    where: { id: session.user.id },
    data: gmailVerifiedClearFields(),
  });
}

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
