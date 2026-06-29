// Single source of truth for computing a user's Postmark inbound forwarding
// address — used by the settings page and both admin views.
//
// Mid-migration to a custom inbound domain (mail.myreturnwindow.com): the
// new format is bare `<inboundToken>@mail.myreturnwindow.com` — no
// "+tag" hash prefix, since the whole subdomain is now dedicated to this
// app rather than shared across every Postmark customer. Piloted on one
// account at a time via INBOUND_DOMAIN + INBOUND_DOMAIN_PILOT_EMAIL,
// deliberately separate from ADMIN_USER_EMAIL even though they hold the
// same value right now — "who's in the migration pilot" and "who can see
// the admin pages" are different concerns that happen to coincide today.
// Unset either env var and every account (including the pilot) falls back
// to the old, known-working postmarkapp.com format.
export function getInboundAddress(inboundToken: string, userEmail: string): string {
  const pilotDomain = process.env.INBOUND_DOMAIN;
  const pilotEmail = process.env.INBOUND_DOMAIN_PILOT_EMAIL;

  if (pilotDomain && pilotEmail && userEmail === pilotEmail) {
    return `${inboundToken}@${pilotDomain}`;
  }

  return `${process.env.POSTMARK_INBOUND_HASH}+${inboundToken}@inbound.postmarkapp.com`;
}
