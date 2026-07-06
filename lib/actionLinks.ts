import { signToken } from "@/lib/actionToken";

const APP_URL = "https://app.myreturnwindow.com";

// The one place email templates (reminder cron, weekly digest — Phase 5) go
// to embed a one-tap action button. Wraps signToken so callers never build
// the URL shape or touch the token format directly.
export function buildActionLink(params: { orderId: string; userId: string; action: string }): string {
  const token = signToken(params);
  return `${APP_URL}/action/${params.action}?token=${encodeURIComponent(token)}`;
}
