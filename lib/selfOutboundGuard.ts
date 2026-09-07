// Self-email ingestion loop guard — TASKS.md 🔴 Now, 2026-09-02. Users'
// Gmail auto-forward rules (the same kind of rule our own onboarding sets
// up) route our own outbound reminder/digest/refund-check-in emails back
// into our own inbound webhook, corrupting Order fields (confirmed on
// returnPortalUrl — see investigations/2026-09-02-extraction-root-cause/).
// Root-cause investigation (2026-09-02) confirmed every real occurrence
// arrives with From: unchanged as our own outbound sender address (Gmail's
// auto-forward preserves the original From/Return-Path rather than
// rewriting it to the forwarding user, unlike a manual "Fwd:") — so a
// From/Return-Path domain match alone reliably distinguishes a looped-back
// send of ours from a genuine user reply, which always carries the
// replying user's own address as From, never ours.

import { extractDomain } from "@/lib/foodGroceryExclusion";
import type { RawHeader } from "@/lib/forwardResolver";

// Every outbound sender (reminders@, hello@, and any future subdomain-based
// address) lives under this root domain in production — see
// REMINDER_FROM_EMAIL/LOGIN_FROM_EMAIL. Bare-or-subdomain match, same shape
// as isFoodGroceryDomain.
export const OWN_ROOT_DOMAIN = "myreturnwindow.com";

export function isOwnDomain(domain: string): boolean {
  const normalized = domain.toLowerCase();
  return normalized === OWN_ROOT_DOMAIN || normalized.endsWith(`.${OWN_ROOT_DOMAIN}`);
}

// The exact "from" addresses this app's Postmark send ever uses — enumerated
// 2026-09-07 by tracing every sendEmail() call site back to its source
// (reminders/refund-check-in/weekly-coverage/weekly-digest/adminNotify all
// resolve to REMINDER_FROM_EMAIL; the magic-link login send resolves to
// LOGIN_FROM_EMAIL, falling back to REMINDER_FROM_EMAIL) and confirmed
// against live production env values (reminders@ / hello@myreturnwindow.com).
// Read from env, not hardcoded, so this tracks a real address rotation.
// Deliberately narrower than OWN_ROOT_DOMAIN: the header-chain check below
// (condition 3) exists to catch OUR OWN mail if it somehow leaks through
// with a rewritten From, not to catch "any mail whose forwarding headers
// mention our domain" — the latter is true of every Gmail-auto-forwarded
// email routed to this app at all, self-loop or not, because the forward
// target IS our domain (2026-09-07 postmark-ingestion-diagnostic.md).
function ownSendingAddresses(): string[] {
  return [process.env.REMINDER_FROM_EMAIL, process.env.LOGIN_FROM_EMAIL]
    .filter((value): value is string => !!value)
    .map((value) => value.toLowerCase());
}

function findHeaderValue(headers: RawHeader[] | null | undefined, name: string): string | null {
  if (!headers) return null;
  const lower = name.toLowerCase();
  const found = headers.find((h) => h.Name?.toLowerCase() === lower);
  return found?.Value ?? null;
}

// Return-Path is often formatted as an angle-bracketed address
// ("<reminders@myreturnwindow.com>") or carries VERP-style extra segments
// on some providers — extract whatever looks like a domain after the last
// "@" the same way extractDomain does, tolerant of the wrapping.
function domainFromHeaderValue(value: string | null): string {
  if (!value) return "";
  const match = value.match(/@([^\s>]+)/);
  return match ? match[1].toLowerCase() : "";
}

export interface SelfOutboundDetection {
  isSelfOutbound: boolean;
  reason: "from_domain" | "return_path_domain" | "header_chain_auto_forward" | null;
}

// (a) From / Return-Path / envelope sender matches our own domain — the
// signal confirmed against every real self-loop row found in production.
// (b) belt-and-suspenders: an auto-forward (classifyForwardType === "auto")
// whose header chain otherwise mentions one of our own SENDING addresses
// (e.g. a Delivered-To or X-Original-* header a provider other than Gmail
// might use), in case (a) is ever defeated by a forwarding path that
// rewrites From/Return-Path. Not expected to fire in current data — Gmail's
// auto forward never rewrites From — but cheap to keep as a second line.
// FIX 2026-09-07 (docs/audits/2026-09-07-postmark-ingestion-diagnostic.md,
// 2026-09-07-guard-tradeoff-diagnostic.md): this used to match on the bare
// OWN_ROOT_DOMAIN string anywhere in any header, which fired on ANY
// Gmail-auto-forwarded email routed to this app — the forwarding headers
// (Return-Path VERP, X-Forwarded-To) always contain our domain as the
// forward *destination*, self-loop or not. Narrowed to our own sending
// addresses specifically, which only a genuine loop's original envelope
// would carry.
export function detectSelfOutboundLoop(params: {
  fromEmail: string | null | undefined;
  headers: RawHeader[] | null | undefined;
  forwardType: "auto" | "manual";
}): SelfOutboundDetection {
  const { fromEmail, headers, forwardType } = params;

  const fromDomain = extractDomain(fromEmail ?? "");
  if (isOwnDomain(fromDomain)) {
    return { isSelfOutbound: true, reason: "from_domain" };
  }

  const returnPathDomain = domainFromHeaderValue(findHeaderValue(headers, "Return-Path"));
  if (isOwnDomain(returnPathDomain)) {
    return { isSelfOutbound: true, reason: "return_path_domain" };
  }

  const sendingAddresses = ownSendingAddresses();
  if (
    forwardType === "auto" &&
    headers?.some((h) => sendingAddresses.some((addr) => (h.Value ?? "").toLowerCase().includes(addr)))
  ) {
    return { isSelfOutbound: true, reason: "header_chain_auto_forward" };
  }

  return { isSelfOutbound: false, reason: null };
}
