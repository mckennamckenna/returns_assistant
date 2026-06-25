import Link from "next/link";

function ComingSoonItem({ label }: { label: string }) {
  return (
    <span className="flex items-center justify-between px-3 py-2 rounded-lg text-sm text-stone-400 cursor-default">
      {label}
      <span className="text-[10px] uppercase tracking-wide bg-stone-100 text-stone-400 px-1.5 py-0.5 rounded">
        Soon
      </span>
    </span>
  );
}

export function Sidebar({ alertCount, accountLabel }: { alertCount: number; accountLabel: string }) {
  return (
    <aside className="w-60 shrink-0 bg-white border-r border-stone-200 flex flex-col h-screen sticky top-0">
      <div className="px-5 py-6">
        <span className="text-lg font-semibold text-stone-800">Returns assistant</span>
      </div>

      <nav className="flex-1 px-3 flex flex-col gap-1">
        <Link
          href="/"
          className="flex items-center px-3 py-2 rounded-lg text-sm font-medium bg-rose-100 text-rose-800"
        >
          Dashboard
        </Link>
        <ComingSoonItem label="Returns" />
        <ComingSoonItem label="Purchases" />
        <ComingSoonItem label="Insights" />
        <span className="flex items-center justify-between px-3 py-2 rounded-lg text-sm text-stone-400 cursor-default">
          Alerts
          {alertCount > 0 && (
            <span className="text-xs font-semibold bg-rose-500 text-white px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
              {alertCount}
            </span>
          )}
        </span>
        <Link href="/settings" className="flex items-center px-3 py-2 rounded-lg text-sm text-stone-600 hover:bg-stone-50">
          Settings
        </Link>
        <Link href="/privacy" className="flex items-center px-3 py-2 rounded-lg text-sm text-stone-600 hover:bg-stone-50">
          Privacy
        </Link>
      </nav>

      <div className="px-3 py-4 border-t border-stone-200">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700 text-sm font-semibold">
            {accountLabel.slice(0, 1).toUpperCase()}
          </span>
          <span className="text-sm text-stone-600 truncate">{accountLabel}</span>
        </div>
      </div>
    </aside>
  );
}
