"use client";

import { useState } from "react";
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
  const base = "text-xs font-medium rounded-lg px-2.5 py-1 disabled:opacity-50";
  const style = primary ? "bg-rose-600 text-white hover:bg-rose-700" : "border border-stone-300 text-stone-700 hover:bg-stone-50";

  return (
    <button type="submit" formAction={formAction} disabled={pending} className={`${base} ${style}`}>
      {pending ? "…" : label}
    </button>
  );
}

// Everything below the plain-language label (rendered by the caller) lives
// here: the retailer line, the "Read more" toggle, and everything that
// toggle reveals — extractionNotes, the user's previous note, and the
// note-writing textarea. The textarea has to live in this same component
// (not a sibling) because it needs to share one <form> with the two
// always-visible action buttons below, even while it's only rendered when
// expanded — submitting "Looks correct" without ever expanding just means
// no note field exists in the form data, identical to leaving it blank.
export function ReviewCard({
  retailerLine,
  note,
  userNote,
  approveAction,
  splitAction,
}: {
  retailerLine: string;
  note: string;
  userNote: string | null;
  approveAction: (formData: FormData) => void;
  splitAction: (formData: FormData) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between gap-3 mt-0.5 leading-tight">
        <p className="text-xs text-stone-400 truncate">{retailerLine}</p>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="text-xs underline text-stone-500 hover:text-stone-700 shrink-0"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      </div>
      {expanded && (
        <div className="mt-2 text-xs text-stone-400 flex flex-col gap-1.5">
          <p>{note}</p>
          {userNote && <p className="italic text-stone-500 border-l-2 border-amber-300 pl-2">Your note: {userNote}</p>}
        </div>
      )}
      <form className="mt-2 flex flex-col gap-2">
        {expanded && (
          <textarea
            name="note"
            placeholder="What do you think happened here? How would you fix it?"
            rows={2}
            className="bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm placeholder:text-stone-400"
          />
        )}
        <div className="flex gap-2">
          <ReviewButton formAction={approveAction} label="Looks correct" primary />
          <ReviewButton formAction={splitAction} label="Split into separate order" />
        </div>
      </form>
    </>
  );
}
