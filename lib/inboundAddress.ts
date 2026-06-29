// Single source of truth for computing a user's Postmark inbound forwarding
// address — used by the settings page and both admin views.
//
// Migrated off the shared inbound.postmarkapp.com domain onto a custom
// domain (mail.myreturnwindow.com): the address is bare
// `<inboundToken>@mail.myreturnwindow.com` — no "+tag" hash prefix, since
// the whole subdomain is now dedicated to this app rather than shared
// across every Postmark customer. Piloted on one account first (see
// BUILD.md Milestone 19 — confirmed working with a real forwarded order),
// then rolled out to everyone here once confirmed.
//
// Safe in either direction: app/api/inbound/route.ts's extractInboundToken()
// still checks the old "+tag" (MailboxHash) format first, unconditionally —
// anyone whose forwarding rule still points at their old address keeps
// working exactly as before. This only changes what gets *displayed* going
// forward; nobody's existing forward silently breaks because of this change.
export function getInboundAddress(inboundToken: string): string {
  const domain = process.env.INBOUND_DOMAIN;
  if (domain) {
    return `${inboundToken}@${domain}`;
  }
  return `${process.env.POSTMARK_INBOUND_HASH}+${inboundToken}@inbound.postmarkapp.com`;
}
