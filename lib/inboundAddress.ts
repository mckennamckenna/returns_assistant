// Single source of truth for computing a user's Postmark inbound forwarding
// address — used by both the user-facing settings page and the admin
// onboarding view, so there's exactly one place to update when inbound
// moves off the shared inbound.postmarkapp.com domain onto a custom domain
// (at which point POSTMARK_INBOUND_HASH will likely disappear entirely,
// since the whole subdomain would be dedicated to this app rather than
// shared across every Postmark customer).
export function getInboundAddress(inboundToken: string): string {
  return `${process.env.POSTMARK_INBOUND_HASH}+${inboundToken}@inbound.postmarkapp.com`;
}
