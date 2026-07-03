import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { notifyAdmin } from "@/lib/adminNotify";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
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

  await notifyAdmin("New beta signup", `New beta signup: ${email}`);

  return NextResponse.json({ ok: true });
}
