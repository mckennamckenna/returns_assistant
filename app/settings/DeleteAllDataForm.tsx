"use client";

import { useState } from "react";
import { deleteAllData } from "./actions";

const CONFIRM_TEXT = "DELETE";

export function DeleteAllDataForm() {
  const [confirmText, setConfirmText] = useState("");
  const [pending, setPending] = useState(false);
  const canDelete = confirmText === CONFIRM_TEXT;

  return (
    <form
      action={async () => {
        setPending(true);
        await deleteAllData();
      }}
      className="flex flex-col gap-3 max-w-sm"
    >
      <label className="text-sm text-secondary">
        Type <strong>{CONFIRM_TEXT}</strong> to confirm. This permanently removes every email, order, and reminder —
        there is no undo.
      </label>
      <input
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder={CONFIRM_TEXT}
        autoComplete="off"
        className="border border-border rounded px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={!canDelete || pending}
        className="bg-red-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {pending ? "Deleting…" : "Delete all my data"}
      </button>
    </form>
  );
}
