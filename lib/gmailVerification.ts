const GMAIL_FORWARDING_SENDER = "forwarding-noreply@google.com";
const SUBJECT_MARKERS = ["Gmail Forwarding Confirmation", "Forwarding Confirmation Request"];

export function isGmailForwardingVerification(fromEmail: string | undefined, subject: string | undefined): boolean {
  if (!fromEmail || !subject) return false;
  if (fromEmail.toLowerCase() !== GMAIL_FORWARDING_SENDER) return false;
  return SUBJECT_MARKERS.some((marker) => subject.includes(marker));
}

export interface ExtractedVerification {
  code: string | null;
  link: string | null;
}

// Best-effort only — the caller always includes the raw email body
// alongside whatever this finds, so an imperfect match here never loses
// information, just makes the admin read one more line.
export function extractVerificationDetails(body: string | null | undefined): ExtractedVerification {
  const source = body ?? "";

  const linkMatch = source.match(/https:\/\/[^\s"<>]*google\.com[^\s"<>]*/i) ?? source.match(/https:\/\/[^\s"<>]+/i);
  const link = linkMatch ? linkMatch[0] : null;

  // The confirmation code is normally presented on its own line, separate
  // from the surrounding sentence and much shorter than the link.
  const codeLine = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^[A-Za-z0-9]{4,12}$/.test(line) && line !== link);

  return { code: codeLine ?? null, link };
}
