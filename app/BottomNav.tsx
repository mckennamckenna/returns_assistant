import Link from "next/link";

// Hand-rolled, minimal stroke icons — no icon library dependency for
// three glyphs. Sized to match the rest of the app's restrained,
// text/unicode-symbol visual language (✕, ↑, ↓, →, ▾ elsewhere).
function HomeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9a6 6 0 1 1 12 0c0 3 1 4.5 1.5 5.5H4.5C5 13.5 6 12 6 9Z" />
      <path d="M9.5 18a2.5 2.5 0 0 0 5 0" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l1.8-1.4-2-3.4-2.1.6a7.6 7.6 0 0 0-2.6-1.5L14 2h-4l-.5 2.2a7.6 7.6 0 0 0-2.6 1.5l-2.1-.6-2 3.4L4.6 10a7.7 7.7 0 0 0 0 3l-1.8 1.5 2 3.4 2.1-.6c.76.66 1.64 1.17 2.6 1.5L10 22h4l.5-2.2a7.6 7.6 0 0 0 2.6-1.5l2.1.6 2-3.4-1.8-1.5Z" />
    </svg>
  );
}

export function BottomNav({ alertCount }: { alertCount: number }) {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-10 bg-white border-t border-stone-200 flex items-stretch h-16 pb-[env(safe-area-inset-bottom)]">
      <Link href="/" className="flex-1 flex flex-col items-center justify-center gap-0.5 text-rose-700">
        <HomeIcon />
        <span className="text-[10px] font-medium">Dashboard</span>
      </Link>
      <div className="flex-1 flex flex-col items-center justify-center gap-0.5 text-stone-400 relative">
        <span className="relative">
          <BellIcon />
          {alertCount > 0 && (
            <span className="absolute -top-1 -right-1.5 text-[10px] font-semibold bg-rose-500 text-white px-1 rounded-full min-w-[1rem] text-center leading-[1rem]">
              {alertCount}
            </span>
          )}
        </span>
        <span className="text-[10px]">Alerts</span>
      </div>
      <Link href="/settings" className="flex-1 flex flex-col items-center justify-center gap-0.5 text-stone-500">
        <GearIcon />
        <span className="text-[10px]">Settings</span>
      </Link>
    </nav>
  );
}
