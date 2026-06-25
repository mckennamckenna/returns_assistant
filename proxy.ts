import { NextResponse } from "next/server";
import { auth } from "@/auth";

export default auth((req) => {
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
