"use server";

import { revalidatePath } from "next/cache";
import { runExtraction } from "@/lib/runExtraction";

export async function reExtract(id: string) {
  await runExtraction(id);
  revalidatePath(`/emails/${id}`);
}
