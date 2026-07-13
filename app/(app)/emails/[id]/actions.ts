"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { runExtraction } from "@/lib/runExtraction";

export async function reExtract(id: string) {
  const session = await auth();
  if (!session?.user) return;

  // Ownership check — this action is directly invocable, independent of
  // whichever page rendered the button.
  const email = await prisma.email.findUnique({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!email) return;

  await runExtraction(id);
  revalidatePath(`/emails/${id}`);
}
