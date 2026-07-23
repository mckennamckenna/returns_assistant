import { prisma } from "@/lib/db";

// Junk is a soft state on Email.junkedAt — never a delete. An email that's
// been auto-filed as confirmed non-commerce is still fully recoverable via
// rescueEmail() below; prisma.email.delete() is never involved anywhere in
// this file. See prisma/schema.prisma's Email.junkedAt comment for the full
// contract and BUILD.md for the invariant this file exists to protect.

// Prisma where-clause fragment that excludes junked emails. Spread this into
// any findMany/findFirst where clause that lists emails for a human to see —
// same pattern as lib/orderFilters.ts's activeOrderFilter. Consumer audit
// (2026-07-22, same discipline as the displayStatus rung's autoArchive
// gap): every prisma.email.findMany/findFirst/count call site in the
// codebase was checked. Two real consumers needed this filter — both
// updated in the same change: the dashboard's "Unlinked emails" list
// (app/(app)/page.tsx) and the weekly coverage-check digest's content query
// (app/api/cron/weekly-coverage/route.ts, which lists a user's unlinked
// emails by retailer name in a real outbound email — a junked marketing
// email showing up there would read as "did we catch this?" about content
// that was never a purchase). Every other prisma.email.* call site is
// scoped by orderId, which junked emails can never carry (junking only
// ever applies to orphaned emails — see shouldAutoJunk below) — those sites
// are structurally unreachable by a junked row and were left unchanged.
export const JUNK_FILTER = {
  junkedAt: null,
} as const;

// Pure function — safe to test without DB or mocks. Scoped deliberately
// narrow: ONLY emailType === "other" on an orphaned email (orderId still
// null at the point this is checked). Two real populations were confirmed
// (2026-07-22 diagnostic, real production data) to look superficially
// similar but must never auto-junk:
//   - commerce-typed but unlinked (delivery/shipping_confirmation/
//     order_confirmation with orderNumber: null) — 15 real cases found,
//     12 of 15 with an obvious candidate order already in the system.
//     These are real purchases; junking them would hide money-costing
//     data from the user. Tracked separately (TASKS.md 🔴 Now, the
//     no-fallback-matcher gap) — not this file's problem to solve, but
//     definitely this file's problem not to make worse.
//   - emailType === null — the runExtraction.ts catch-block failure
//     fingerprint (a genuinely successful extraction always sets
//     emailType to something, even "other"). An extraction failure is not
//     evidence of anything about the email's content; must stay visible
//     for a human (or a re-extraction) to resolve.
export function shouldAutoJunk(email: { emailType: string | null; orderId: string | null }): boolean {
  return email.orderId === null && email.emailType === "other";
}

// Clears the junk flag and records the rescue as its own event (not just a
// counter) so a rescue rate is computable later, per-user, not only in
// aggregate — see EmailRescue in prisma/schema.prisma. Returns the email's
// userId on success (so callers can attribute the rescue) or null if the
// email doesn't exist. No auth/ownership check here — same convention as
// lib/orderReview.ts's approveOrder/splitOrder ("callers are responsible
// for their own access control"); this is backend-only in this change, not
// wired to a route yet.
export async function rescueEmail(emailId: string): Promise<{ userId: string } | null> {
  const email = await prisma.email.findUnique({ where: { id: emailId }, select: { userId: true, junkedAt: true } });
  if (!email) return null;

  await prisma.$transaction([
    prisma.email.update({ where: { id: emailId }, data: { junkedAt: null } }),
    prisma.emailRescue.create({ data: { emailId, userId: email.userId } }),
  ]);

  return { userId: email.userId };
}
