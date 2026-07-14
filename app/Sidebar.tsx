"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { signOutAction } from "./actions";

function ComingSoonItem({ label }: { label: string }) {
  return (
    <span className="flex items-center justify-between px-3 py-1.5 rounded-r-lg text-[15px] text-muted cursor-default border-l-[3px] border-transparent">
      {label}
      <span className="text-[11px] uppercase tracking-wide bg-border text-muted px-1.5 py-0.5 rounded-full">
        Soon
      </span>
    </span>
  );
}

export function Sidebar({ alertCount, accountLabel }: { alertCount: number; accountLabel: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onDashboardRoute = pathname === "/";
  const archived = searchParams.get("status") === "archived";
  const dashboardActive = onDashboardRoute && !archived;
  const archivedActive = onDashboardRoute && archived;

  // Left-border active indicator, not a background highlight — the sidebar's
  // own background is the page color (return-window-design-tokens.md §6),
  // so a background-tint highlight on the active item would be invisible
  // against it. Every item shares the same border-left box model (active or
  // not) so nothing shifts horizontally when the active item changes.
  // rounded-r-lg (not rounded-lg) — corners on the border side must stay
  // square, or the left border follows the curve and reads as a stray
  // bracket/parenthesis next to the label instead of a flush accent line.
  // See TRUST_AUDIT.md row 2.
  function navClass(active: boolean): string {
    return `flex items-center px-3 py-1.5 rounded-r-lg text-[15px] border-l-[3px] ${
      active ? "border-ink text-ink font-medium" : "border-transparent text-secondary font-normal hover:bg-card"
    }`;
  }

  return (
    <aside className="hidden md:flex w-60 shrink-0 bg-page border-r border-border flex-col h-screen sticky top-0">
      <div className="px-5 py-6">
        <span className="text-lg font-medium text-ink">Return Window</span>
      </div>

      <nav className="flex-1 px-3 flex flex-col gap-1">
        <Link href="/" className={navClass(dashboardActive)}>
          Dashboard
        </Link>
        <Link href="/?status=archived" className={navClass(archivedActive)}>
          Archived
        </Link>
        <ComingSoonItem label="Returns" />
        <ComingSoonItem label="Purchases" />
        <ComingSoonItem label="Insights" />
        <span className="flex items-center justify-between px-3 py-1.5 rounded-r-lg text-[15px] text-muted cursor-default border-l-[3px] border-transparent">
          Alerts
          {alertCount > 0 && (
            <span className="text-xs font-semibold bg-ink text-page px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
              {alertCount}
            </span>
          )}
        </span>
        <Link href="/settings" className={navClass(pathname === "/settings")}>
          Settings
        </Link>
        <Link href="/privacy" className={navClass(pathname === "/privacy")}>
          Privacy
        </Link>
      </nav>

      <div className="px-3 py-4 border-t border-border">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card text-ink border border-border text-sm font-semibold">
            {accountLabel.slice(0, 1).toUpperCase()}
          </span>
          <span className="text-[13px] text-muted truncate">{accountLabel}</span>
        </div>
        <form action={signOutAction}>
          <button type="submit" className="w-full text-left px-3 py-2 rounded-lg text-[13px] text-muted hover:bg-card">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
