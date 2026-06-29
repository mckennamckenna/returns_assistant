import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { getInboundAddress } from "@/lib/inboundAddress";
import { CopyButton } from "@/app/settings/CopyButton";

export const dynamic = "force-dynamic";

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function AdminOnboardingPage() {
  // Identity-based gate, not the shared-secret pattern the rest of /admin
  // uses — this page shows every user's real forwarding address, so it's
  // scoped to one specific account rather than "anyone who knows a secret."
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.email !== process.env.ADMIN_USER_EMAIL) {
    notFound();
  }

  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto w-full">
      <h1 className="text-2xl font-semibold mb-2">Onboarding</h1>
      <p className="text-sm text-stone-500 mb-8">
        Each user's forwarding address — copy one to send to a friend, or to remind someone who already signed up.
      </p>

      <div className="flex flex-col gap-3">
        {users.map((user) => {
          const inboundAddress = getInboundAddress(user.inboundToken, user.email);
          return (
            <div key={user.id} className="bg-white border border-stone-200 rounded-lg p-4">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-medium text-stone-800">{user.email}</span>
                <span className="text-xs text-stone-400 whitespace-nowrap">Joined {formatDate(user.createdAt)}</span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <code className="flex-1 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm text-stone-700 break-all">
                  {inboundAddress}
                </code>
                <CopyButton text={inboundAddress} />
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
