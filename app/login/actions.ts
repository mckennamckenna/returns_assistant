"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { MagicLinkRateLimitError } from "@/lib/magicLinkRateLimit";

export async function sendMagicLink(formData: FormData): Promise<{ error?: string }> {
  try {
    // Without redirectTo, signIn defaults to the current page — which is
    // this very form, so a successful magic-link click would bounce back
    // to /login instead of the dashboard. Send users to "/" explicitly.
    await signIn("nodemailer", formData, { redirectTo: "/" });
    return {};
  } catch (error) {
    // Checked before the generic AuthError case below, since
    // MagicLinkRateLimitError is itself an AuthError subclass — this is
    // the one case with copy specific enough to be worth distinguishing.
    // See auth.ts / TASKS.md's Decisions log for why this is a
    // user-visible message rather than a silent no-op.
    if (error instanceof MagicLinkRateLimitError) {
      return { error: "You've requested several sign-in links recently. Please wait a few minutes and try again." };
    }
    if (error instanceof AuthError) {
      return { error: "Couldn't send the link. Check the email address and try again." };
    }
    // Not an auth error — likely Next.js's internal redirect signal on
    // success. Must rethrow so the redirect actually happens.
    throw error;
  }
}
