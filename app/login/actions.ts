"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export async function sendMagicLink(formData: FormData): Promise<{ error?: string }> {
  try {
    // Without redirectTo, signIn defaults to the current page — which is
    // this very form, so a successful magic-link click would bounce back
    // to /login instead of the dashboard. Send users to "/" explicitly.
    await signIn("nodemailer", formData, { redirectTo: "/" });
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
