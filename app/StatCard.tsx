export function StatCard({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl p-5">
      <div className="text-sm text-stone-500">{label}</div>
      <div className="text-2xl font-semibold text-stone-800 mt-1">{value}</div>
      {sublabel && <div className="text-xs text-stone-400 mt-1">{sublabel}</div>}
    </div>
  );
}
