// Next.js boot hook (stable since Next 15, no experimental flag needed) —
// runs once per server/function instance on cold start. The closest
// equivalent to "refuse to boot" available in a serverless deployment.
export async function register() {
  const { validateTokenSigningSecret } = await import("@/lib/actionToken");
  validateTokenSigningSecret(process.env.TOKEN_SIGNING_SECRET);
}
