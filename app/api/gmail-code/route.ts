import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { buildGmailCodeResponse } from "@/lib/gmailVerification";

// Polled every 3s from the setup page while waiting for Gmail's
// forwarding-confirmation code to arrive. A 401 here (rather than a
// redirect) is deliberate — this is a fetch target, not a page navigation.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { gmailVerificationCode: true, gmailVerificationCodeReceivedAt: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(buildGmailCodeResponse(user));
}
