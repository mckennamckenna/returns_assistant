import { NextRequest, NextResponse } from "next/server";
import { runExtractionSweep } from "@/lib/extractionSweep";

// Deliberately its own route, NOT part of app/api/cron/route.ts. That route
// sends real reminder emails to real users and carries a documented scar (a
// ?force=true test run once silently consumed three users' reminder slots).
// Nothing here ever emails a user; the only outbound mail is the admin
// notification on failure.
export const dynamic = "force-dynamic";

// Must cover a full worst-case extraction — two bounded extraction passes
// plus a bounded policy lookup — with margin, and must not exceed the
// platform's function limit. See lib/extractionSweep.ts, where the per-run
// budget guard is derived from the same timeout constants.
export const maxDuration = 300;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) return true;

  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runExtractionSweep();
  console.log("extraction-sweep:", JSON.stringify(result));
  return NextResponse.json({ ok: true, ...result });
}
