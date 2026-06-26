"use client";

import { useFormStatus } from "react-dom";

function ReviewButton({
  formAction,
  label,
  primary,
}: {
  formAction: (formData: FormData) => void;
  label: string;
  primary?: boolean;
}) {
  const { pending } = useFormStatus();
  const base = "text-sm font-medium rounded-lg px-3 py-1.5 disabled:opacity-50";
  const style = primary ? "bg-rose-600 text-white hover:bg-rose-700" : "border border-stone-300 text-stone-700 hover:bg-stone-50";

  return (
    <button type="submit" formAction={formAction} disabled={pending} className={`${base} ${style}`}>
      {pending ? "…" : label}
    </button>
  );
}

export function ReviewActions({
  approveAction,
  splitAction,
}: {
  approveAction: (formData: FormData) => void;
  splitAction: (formData: FormData) => void;
}) {
  return (
    <form className="mt-3 flex flex-col gap-2">
      <textarea
        name="note"
        placeholder="What do you think happened here? How would you fix it?"
        rows={2}
        className="bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm placeholder:text-stone-400"
      />
      <div className="flex gap-2">
        <ReviewButton formAction={approveAction} label="Looks correct" primary />
        <ReviewButton formAction={splitAction} label="Split into separate order" />
      </div>
    </form>
  );
}
