import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Bare-domain visitors get the public marketing page, not the dashboard —
// both are already aliased to this same Vercel deployment.
const MARKETING_HOSTNAMES = ["myreturnwindow.com", "www.myreturnwindow.com"];

export default auth((req) => {
  const host = req.headers.get("host")?.split(":")[0];
  if (host && MARKETING_HOSTNAMES.includes(host)) {
    return NextResponse.rewrite(new URL("/marketing", req.url));
  }

  if (!req.auth) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  // Dashboard, order/email detail pages, and settings require a session.
  // /login, /privacy, the NextAuth routes, and the inbound/cron webhooks
  // are intentionally excluded.
  matcher: ["/", "/orders/:path*", "/emails/:path*", "/settings"],
};
