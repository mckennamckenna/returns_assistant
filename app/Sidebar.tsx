import Link from "next/link";
import { signOutAction } from "./actions";

function ComingSoonItem({ label }: { label: string }) {
  return (
    <span className="flex items-center justify-between px-3 py-2 rounded-lg text-sm text-muted cursor-default">
      {label}
      <span className="text-[10px] uppercase tracking-wide bg-page text-muted px-1.5 py-0.5 rounded">
        Soon
      </span>
    </span>
  );
}

export function Sidebar({ alertCount, accountLabel }: { alertCount: number; accountLabel: string }) {
  return (
    <aside className="hidden md:flex w-60 shrink-0 bg-card border-r border-border flex-col h-screen sticky top-0">
      <div className="px-5 py-6">
        <span className="text-lg font-semibold text-ink">Return Window</span>
      </div>

      <nav className="flex-1 px-3 flex flex-col gap-1">
        <Link
          href="/"
          className="flex items-center px-3 py-2 rounded-lg text-sm font-medium bg-page text-ink"
        >
          Dashboard
        </Link>
        <Link
          href="/?status=archived"
          className="flex items-center px-3 py-2 rounded-lg text-sm text-secondary hover:bg-page"
        >
          Archived
        </Link>
        <ComingSoonItem label="Returns" />
        <ComingSoonItem label="Purchases" />
        <ComingSoonItem label="Insights" />
        <span className="flex items-center justify-between px-3 py-2 rounded-lg text-sm text-muted cursor-default">
          Alerts
          {alertCount > 0 && (
            <span className="text-xs font-semibold bg-ink text-page px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
              {alertCount}
            </span>
          )}
        </span>
        <Link href="/settings" className="flex items-center px-3 py-2 rounded-lg text-sm text-secondary hover:bg-page">
          Settings
        </Link>
        <Link href="/privacy" className="flex items-center px-3 py-2 rounded-lg text-sm text-secondary hover:bg-page">
          Privacy
        </Link>
      </nav>

      <div className="px-3 py-4 border-t border-border">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-page text-ink border border-border text-sm font-semibold">
            {accountLabel.slice(0, 1).toUpperCase()}
          </span>
          <span className="text-sm text-secondary truncate">{accountLabel}</span>
        </div>
        <form action={signOutAction}>
          <button type="submit" className="w-full text-left px-3 py-2 rounded-lg text-sm text-secondary hover:bg-page">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
