"use server";

import { revalidatePath } from "next/cache";
import { isValidAdminSecret } from "@/lib/adminAuth";
import { approveOrder, splitOrder } from "@/lib/orderReview";

// Independently re-validates the secret on every call — these are
// directly invocable server actions, not protected merely by the page
// that links to them. No userNote here: the admin actions are one-click,
// the note-taking UI is user-facing only (see app/ReviewActions.tsx).

export async function adminApproveAction(orderId: string, formData: FormData): Promise<void> {
  const secret = formData.get("secret");
  if (typeof secret !== "string" || !isValidAdminSecret(secret)) return;

  await approveOrder(orderId, null);
  revalidatePath("/admin");
}

export async function adminSplitAction(orderId: string, formData: FormData): Promise<void> {
  const secret = formData.get("secret");
  if (typeof secret !== "string" || !isValidAdminSecret(secret)) return;

  await splitOrder(orderId, null);
  revalidatePath("/admin");
}
