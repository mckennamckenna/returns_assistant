import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getAlertOrders } from "@/lib/alerts";
import { OrderCard } from "@/app/OrderCard";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const now = new Date();
  const orders = await getAlertOrders(session.user.id, now);

  return (
    <main className="flex-1 min-w-0 px-5 pt-4 pb-20 md:pb-8 md:pl-12 md:pr-8 md:pt-12 max-w-[640px]">
      <header className="mb-[22px]">
        <h1 className="font-serif text-[30px] md:text-[38px] leading-[1.08] font-medium text-ink">Alerts</h1>
        <p className="text-sm text-muted mt-1">Orders that need review or are closing soon.</p>
      </header>

      {orders.length === 0 ? (
        <p className="text-secondary">No new alerts.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} now={now} />
          ))}
        </div>
      )}
    </main>
  );
}
