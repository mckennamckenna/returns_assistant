import Link from "next/link";
import { DeleteAllDataForm } from "./DeleteAllDataForm";

export default function SettingsPage() {
  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto w-full">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        &larr; Back to dashboard
      </Link>

      <h1 className="text-2xl font-semibold mt-4 mb-6">Settings</h1>

      <div className="border border-red-200 rounded-lg p-4">
        <h2 className="font-semibold text-red-700 mb-2">Delete all my data</h2>
        <DeleteAllDataForm />
      </div>
    </main>
  );
}
