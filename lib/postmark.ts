const POSTMARK_SEND_URL = "https://api.postmarkapp.com/email";

// TASKS.md 2026-08-27 ("Sender display name change") — REMINDER_FROM_EMAIL
// is a bare address with no display name, so Gmail (and most clients) fall
// back to showing the address's local-part as a pseudo-name: every
// reminder/digest/coverage/admin email showed the sender as literally
// "reminders." Postmark's From field accepts "Display Name <address>"
// natively — wrap every outbound address with this before passing it to
// sendEmail, rather than passing a raw env var straight through.
export const SENDER_DISPLAY_NAME = "My Return Window";

export function formatSenderEmail(email: string): string {
  return `${SENDER_DISPLAY_NAME} <${email}>`;
}

interface SendEmailParams {
  to: string;
  from: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  bcc?: string;
}

// Dev-send guard (TASKS.md 🔴 Now, 2026-09-02) — sendEmail() used to fire a
// real Postmark send from any environment with POSTMARK_SERVER_TOKEN set,
// including local dev. Combined with a stale REMINDER_FROM_EMAIL in a
// developer's .env, that meant a local `npm run dev` run hitting any send
// path (reminder cron, refund check-in, admin notify, magic link) could
// silently email real users. NODE_ENV === "production" is the only send
// path left unguarded — everywhere else defaults to log-and-skip unless a
// developer explicitly opts in for one run via ALLOW_REAL_EMAIL_IN_DEV.
function shouldActuallySend(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  return process.env.ALLOW_REAL_EMAIL_IN_DEV === "true";
}

// htmlBody is optional and additive — TextBody is always sent regardless, as
// the fallback for clients that don't render HTML. Never HTML-only: every
// caller that builds an htmlBody must still pass its plain-text equivalent.
export async function sendEmail({ to, from, subject, textBody, htmlBody, bcc }: SendEmailParams): Promise<void> {
  if (!shouldActuallySend()) {
    console.log("[dev-send-guard] Real email send skipped (not production, ALLOW_REAL_EMAIL_IN_DEV not set):", {
      to,
      from,
      subject,
    });
    return;
  }

  if (process.env.NODE_ENV !== "production" && process.env.ALLOW_REAL_EMAIL_IN_DEV === "true") {
    console.warn("[dev-send-guard] ALLOW_REAL_EMAIL_IN_DEV=true — sending a REAL email from a non-production environment:", {
      to,
      from,
      subject,
    });
  }

  const response = await fetch(POSTMARK_SEND_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": process.env.POSTMARK_SERVER_TOKEN ?? "",
    },
    body: JSON.stringify({
      From: from,
      To: to,
      ...(bcc ? { Bcc: bcc } : {}),
      Subject: subject,
      TextBody: textBody,
      ...(htmlBody ? { HtmlBody: htmlBody } : {}),
      MessageStream: "outbound",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Postmark send failed (${response.status}): ${body}`);
  }
}
