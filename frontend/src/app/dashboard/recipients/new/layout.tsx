import Link from "next/link";
export default function ReadOnlyCreationLayout() {
  return (
    <main className="min-w-0 flex-1 p-8">
      <h1 className="text-2xl font-medium">Creation unavailable</h1>
      <p className="mt-4">
        This interface is read-only. No records, campaigns, funding or payouts
        can be created here.
      </p>
      <Link
        href="/dashboard"
        className="mt-5 inline-block text-forest underline"
      >
        Back to dashboard
      </Link>
    </main>
  );
}
