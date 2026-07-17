import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Sidebar } from "@/app/Sidebar";
import { BottomNav } from "@/app/BottomNav";
import { getAlertOrders } from "@/lib/alerts";

export const dynamic = "force-dynamic";

// Shared chrome for every authenticated app page (dashboard, settings,
// order detail, email detail, alerts) — Sidebar/BottomNav previously only
// rendered from app/page.tsx, so every other route was missing them
// entirely. Route group ((app)) — doesn't affect any URL.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const alertCount = (await getAlertOrders(session.user.id)).length;

  return (
    // min-h-[100vh] first as a fallback for browsers without dvh support
    // (Safari <15.4, Chrome <108) — min-h-[100dvh] overrides it where
    // supported. Swapped from plain min-h-screen (2026-07-17) as an
    // experiment for the Chrome-iOS bell-baseline bug: 100vh doesn't track
    // the actual visible viewport through iOS's URL-bar collapse/expand
    // animation, 100dvh does.
    <div className="flex min-h-[100vh] min-h-[100dvh]">
      <Sidebar alertCount={alertCount} accountLabel={session.user.email ?? "Your account"} />
      <BottomNav alertCount={alertCount} />
      {children}
    </div>
  );
}
