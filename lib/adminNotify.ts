import { sendEmail } from "@/lib/postmark";

// Centralizes "never let an admin notification failure break the real
// flow it's attached to" — a missing ADMIN_EMAIL or a Postmark hiccup
// here shouldn't fail the inbound webhook or the cron run that called it.
export async function notifyAdmin(subject: string, textBody: string): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const fromEmail = process.env.REMINDER_FROM_EMAIL;

  if (!adminEmail || !fromEmail) {
    console.error("ADMIN_EMAIL or REMINDER_FROM_EMAIL not configured, skipping admin notification:", subject);
    return;
  }

  try {
    await sendEmail({ to: adminEmail, from: fromEmail, subject, textBody });
  } catch (error) {
    console.error("Failed to send admin notification:", subject, error);
  }
}
