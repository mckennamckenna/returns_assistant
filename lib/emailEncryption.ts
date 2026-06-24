import { encrypt, decrypt } from "@/lib/crypto";

// The PII fields on Email that get encrypted at rest. Product/extraction
// data (retailer, orderNumber, dates, totals, etc.) stays unencrypted —
// it's not personal data, and leaving it queryable is what lets the
// dashboard/Order matching work without decrypting every row.
interface EmailContentFields {
  fromEmail: string;
  fromName: string | null;
  textBody: string | null;
  htmlBody: string | null;
}

export function encryptEmailContent(fields: EmailContentFields): EmailContentFields {
  return {
    fromEmail: encrypt(fields.fromEmail),
    fromName: fields.fromName != null ? encrypt(fields.fromName) : null,
    textBody: fields.textBody != null ? encrypt(fields.textBody) : null,
    htmlBody: fields.htmlBody != null ? encrypt(fields.htmlBody) : null,
  };
}

export function decryptEmailContent<T extends EmailContentFields>(email: T): T {
  return {
    ...email,
    fromEmail: decrypt(email.fromEmail),
    fromName: email.fromName != null ? decrypt(email.fromName) : null,
    textBody: email.textBody != null ? decrypt(email.textBody) : null,
    htmlBody: email.htmlBody != null ? decrypt(email.htmlBody) : null,
  };
}

export function encryptRawJson(payload: unknown): string {
  return encrypt(JSON.stringify(payload));
}

export function decryptRawJson(encrypted: string): unknown {
  return JSON.parse(decrypt(encrypted));
}
