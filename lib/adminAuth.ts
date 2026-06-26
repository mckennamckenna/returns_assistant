// Stateless by design: every admin page load and every admin action
// re-validates the secret independently (query param on GET, hidden form
// field on each action) rather than establishing a session/cookie. This
// matches the brief — "accessible only via ADMIN_SECRET query param" — and
// keeps the admin surface minimal: no login flow, no session table, just
// one shared secret that's never linked from the user-facing UI.
export function isValidAdminSecret(secret: string | null | undefined): boolean {
  const expected = process.env.ADMIN_SECRET;
  return !!expected && secret === expected;
}
