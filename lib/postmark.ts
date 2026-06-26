const POSTMARK_SEND_URL = "https://api.postmarkapp.com/email";

interface SendEmailParams {
  to: string;
  from: string;
  subject: string;
  textBody: string;
  bcc?: string;
}

export async function sendEmail({ to, from, subject, textBody, bcc }: SendEmailParams): Promise<void> {
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
      MessageStream: "outbound",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Postmark send failed (${response.status}): ${body}`);
  }
}
