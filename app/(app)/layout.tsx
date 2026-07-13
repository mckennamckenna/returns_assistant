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
    <div className="flex min-h-screen">
      <Sidebar alertCount={alertCount} accountLabel={session.user.email ?? "Your account"} />
      <BottomNav alertCount={alertCount} />
      {children}
    </div>
  );
}
