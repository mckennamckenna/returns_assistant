// ANCHOR_DATE_RESOLVER.md Part 2. Run once at ingestion
// (app/api/inbound/route.ts), before/alongside extraction — pure,
// deterministic, no AI call. Produces the forwardType/anchorDate/
// anchorSource trio persisted on Email. Never invents a date: an
// unresolved manual forward resolves to anchorDate: null, which downstream
// callers (lib/linkOrder.ts's resolveFallbackOrderDate) must treat as "no
// anchor available," not fall back to receivedAt for — that fallback is
// exactly the invented-date problem this module exists to close.
import { parseForwardedHeaderDate } from "@/lib/linkOrder";

export type ForwardType = "auto" | "manual";
export type AnchorSource = "original_header" | "received_at" | "quoted_body" | "unresolved";

export interface RawHeader {
  Name?: string;
  Value?: string;
}

function findHeaderValue(headers: RawHeader[] | null | undefined, name: string): string | null {
  if (!headers) return null;
  const lower = name.toLowerCase();
  const found = headers.find((h) => h.Name?.toLowerCase() === lower);
  return found?.Value ?? null;
}

// Gmail-only signature at launch (ANCHOR_DATE_RESOLVER.md Part 4, decision
// 1, 2026-07-25) — the only provider in current data and the only one the
// 2026-07-21 probe verified. Everything else defaults to "manual": the
// conservative choice, since it excludes the email from receivedAt/
// original-header anchoring rather than risking a wrong auto-forward
// assumption. Add other providers' signatures here later, when a
// non-Gmail user actually appears — don't research ahead of need.
export function classifyForwardType(headers: RawHeader[] | null | undefined): ForwardType {
  if (!headers || headers.length === 0) return "manual";

  const returnPath = findHeaderValue(headers, "Return-Path") ?? "";
  const hasGmailAutoForwardMarker = returnPath.includes("+caf_=");
  const hasGmailForwardedHeaders =
    findHeaderValue(headers, "X-Forwarded-For") !== null || findHeaderValue(headers, "X-Forwarded-To") !== null;

  return hasGmailAutoForwardMarker || hasGmailForwardedHeaders ? "auto" : "manual";
}

// ANCHOR_DATE_RESOLVER.md Part 2, Step 2.
export function resolveAnchorDate(params: {
  forwardType: ForwardType;
  headers: RawHeader[] | null | undefined;
  bodyText: string | null;
  receivedAt: Date;
}): { anchorDate: Date | null; anchorSource: AnchorSource } {
  const { forwardType, headers, bodyText, receivedAt } = params;

  if (forwardType === "auto") {
    const originalHeaderDate = findHeaderValue(headers, "Date");
    if (originalHeaderDate) {
      const parsed = new Date(originalHeaderDate);
      if (!Number.isNaN(parsed.getTime())) {
        return { anchorDate: parsed, anchorSource: "original_header" };
      }
    }
    // receivedAt is itself derived from the same Date header via
    // Postmark's own parsing (see app/api/inbound/route.ts) — this is a
    // fallback for the rare case the raw Headers array is missing/
    // malformed, not a materially different value in the common case.
    return { anchorDate: receivedAt, anchorSource: "received_at" };
  }

  // manual — Gmail's quoted "Date:" format only at launch (decision 2).
  // Anything else that doesn't parse falls to the unresolved path, per
  // decision 3 — never a guess.
  const quotedDate = parseForwardedHeaderDate(bodyText);
  if (quotedDate) {
    return { anchorDate: quotedDate, anchorSource: "quoted_body" };
  }
  return { anchorDate: null, anchorSource: "unresolved" };
}

// Replaces the two hardcoded "Forwarded by you" UI call sites
// (app/(app)/page.tsx, app/(app)/emails/[id]/page.tsx). Treats both
// "manual" and null (pre-migration rows, never classified) the same way —
// "manual" is already the conservative default for unclassified mail, so
// there's no real distinction to surface to the user between the two.
export function forwardTypeLabel(forwardType: string | null): string {
  return forwardType === "auto" ? "Forwarded automatically" : "Forwarded by you";
}
