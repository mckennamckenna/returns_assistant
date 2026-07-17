import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { notifyAdmin, hasRecentNotification, recordDedupedNotification } from "@/lib/adminNotify";
import { rateLimit } from "@/lib/rateLimit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const BETA_SIGNUP_RATE_LIMIT = 3;
const BETA_SIGNUP_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

// x-vercel-forwarded-for is set by Vercel's own edge network on every
// request that reaches this function, and — unlike x-forwarded-for —
// can't be altered by an intermediate rewrite or middleware step. Same
// header, same reasoning, and same per-route duplication (not a shared
// helper) as app/api/action/{archive,returned}/route.ts's getClientIp —
// this codebase's existing convention for this exact lookup, not the
// x-forwarded-for/x-real-ip pair. Falls back to a single "unknown" bucket
// if the header is ever absent (e.g. local dev outside Vercel's edge) —
// bounded blast radius: header-less requests share one rate-limit bucket
// instead of each getting their own, never an unlimited bypass.
function getClientIp(request: NextRequest): string {
  return request.headers.get("x-vercel-forwarded-for") ?? "unknown";
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rateLimitResult = await rateLimit({
    key: `beta_signup:${ip}`,
    limit: BETA_SIGNUP_RATE_LIMIT,
    windowSeconds: BETA_SIGNUP_RATE_LIMIT_WINDOW_SECONDS,
  });
  if (!rateLimitResult.allowed) {
    // No admin notification for the block itself — this endpoint is
    // low-value, and a rate-limited script hammering it isn't worth an
    // inbox alert the way inbound-mail or magic-link abuse is.
    const retryAfterSeconds = Math.max(0, Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000));
    return NextResponse.json({ error: "Too Many Requests" }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } });
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  await prisma.betaSignup.upsert({
    where: { email },
    update: {},
    create: { email },
  });

  // The BetaSignup row itself already dedups on email uniqueness (the
  // upsert above) — this is a separate dedup, on the notification, so a
  // script repeatedly submitting the same already-registered email can't
  // flood the admin inbox even though it can't create duplicate rows.
  // Same pattern as auth.ts's allowlist_rejection.
  const subject = "New beta signup";
  const notifyBody = `New beta signup: ${email}`;
  if (await hasRecentNotification("beta_signup", email)) {
    await recordDedupedNotification("beta_signup", subject, notifyBody, email);
  } else {
    await notifyAdmin(subject, notifyBody, "beta_signup", email);
  }

  return NextResponse.json({ ok: true });
}
