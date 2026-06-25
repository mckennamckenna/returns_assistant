"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export async function sendMagicLink(formData: FormData): Promise<{ error?: string }> {
  try {
    await signIn("nodemailer", formData);
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Couldn't send the link. Check the email address and try again." };
    }
    // Not an auth error — likely Next.js's internal redirect signal on
    // success. Must rethrow so the redirect actually happens.
    throw error;
  }
}
