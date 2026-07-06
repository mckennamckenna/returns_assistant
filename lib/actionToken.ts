import { createHmac, timingSafeEqual } from "crypto";

// One place to change the tail length. Phase 5 (embedding tokens in reminder
// and digest email templates) reads this too, so a future tuning of the
// window only needs to change here.
export const ACTION_TOKEN_TTL_DAYS = 14;
const ACTION_TOKEN_TTL_MS = ACTION_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

const MIN_SECRET_BYTES = 32;

export interface ActionTokenPayload {
  orderId: string;
  userId: string;
  action: string;
  issuedAt: number;
}

export type VerifyResult =
  | { valid: true; payload: ActionTokenPayload }
  | { valid: false; reason: "invalid" | "expired" };

// TOKEN_SIGNING_SECRET is hex-encoded, same convention as ENCRYPTION_KEY
// (lib/crypto.ts) — generate via `openssl rand -hex 32`. Decoded byte length
// is what's checked, not the string length, so a shorter hex string (fewer
// entropy bytes) can't slip past a naive character-count check.
function getSecret(): Buffer {
  const hex = process.env.TOKEN_SIGNING_SECRET;
  if (!hex) {
    throw new Error("TOKEN_SIGNING_SECRET is not set");
  }
  const key = Buffer.from(hex, "hex");
  if (key.length < MIN_SECRET_BYTES) {
    throw new Error(`TOKEN_SIGNING_SECRET must be at least ${MIN_SECRET_BYTES} bytes`);
  }
  return key;
}

// Exported so instrumentation.ts (Next.js's boot hook) and this module's own
// getSecret() can both call it — validated once, in one place. Pure: takes
// the raw env value rather than reading process.env itself, so it's testable
// without mocking the environment.
export function validateTokenSigningSecret(hex: string | undefined): void {
  if (!hex) {
    throw new Error("TOKEN_SIGNING_SECRET is not set");
  }
  const key = Buffer.from(hex, "hex");
  if (key.length < MIN_SECRET_BYTES) {
    throw new Error(`TOKEN_SIGNING_SECRET must be at least ${MIN_SECRET_BYTES} bytes`);
  }
}

function sign(encodedPayload: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

// Signs {orderId, userId, action}, stamping issuedAt = now. Compact format:
// base64url(JSON payload) + "." + base64url(HMAC-SHA256 signature) — signing
// the already-encoded payload string (not the raw JSON) avoids any encoding
// ambiguity between what was signed and what gets transmitted.
export function signToken(payload: Omit<ActionTokenPayload, "issuedAt">): string {
  const full: ActionTokenPayload = { ...payload, issuedAt: Date.now() };
  const encodedPayload = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const signature = sign(encodedPayload, getSecret());
  return `${encodedPayload}.${signature}`;
}

// Scoped to one action on one order by construction — expected.action and
// expected.orderId are checked here, inside verification itself, not left
// for each caller to remember. A token issued to archive Order X can't be
// replayed to archive Order Y or to refund Order X.
export function verifyToken(token: string, expected: { action: string; orderId: string }): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, reason: "invalid" };
  }
  const [encodedPayload, signature] = parts;

  let secret: Buffer;
  try {
    secret = getSecret();
  } catch {
    return { valid: false, reason: "invalid" };
  }

  const expectedSignature = sign(encodedPayload, secret);
  const provided = Buffer.from(signature, "base64url");
  const computed = Buffer.from(expectedSignature, "base64url");

  // timingSafeEqual throws on a length mismatch rather than returning false
  // — a truncated or otherwise wrong-length signature is invalid regardless,
  // so this length check is just routing to the same "invalid" outcome, not
  // a shortcut that skips the constant-time comparison for well-formed input.
  if (provided.length !== computed.length) {
    return { valid: false, reason: "invalid" };
  }
  if (!timingSafeEqual(provided, computed)) {
    return { valid: false, reason: "invalid" };
  }

  let payload: ActionTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "invalid" };
  }

  if (
    typeof payload.orderId !== "string" ||
    typeof payload.userId !== "string" ||
    typeof payload.action !== "string" ||
    typeof payload.issuedAt !== "number"
  ) {
    return { valid: false, reason: "invalid" };
  }

  if (payload.action !== expected.action || payload.orderId !== expected.orderId) {
    return { valid: false, reason: "invalid" };
  }

  if (Date.now() - payload.issuedAt > ACTION_TOKEN_TTL_MS) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, payload };
}
