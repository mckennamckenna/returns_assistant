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

// htmlBody is optional and additive — TextBody is always sent regardless, as
// the fallback for clients that don't render HTML. Never HTML-only: every
// caller that builds an htmlBody must still pass its plain-text equivalent.
export async function sendEmail({ to, from, subject, textBody, htmlBody, bcc }: SendEmailParams): Promise<void> {
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
