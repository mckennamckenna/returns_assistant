// One-off: issues a real signed token + CSRF token for Phase 3 curl
// verification, using the actual shipped lib/actionToken.ts functions —
// not a reimplementation.
import { signToken, signCsrfToken } from "@/lib/actionToken";

const orderId = process.argv[2];
const userId = process.argv[3];
const action = process.argv[4] ?? "archive";

if (!orderId || !userId) {
  console.error("Usage: tsx scripts/phase3-issue-token.ts <orderId> <userId> [action]");
  process.exit(1);
}

const token = signToken({ orderId, userId, action });
const csrf = signCsrfToken(token);

console.log("token:", token);
console.log("csrf:", csrf);
