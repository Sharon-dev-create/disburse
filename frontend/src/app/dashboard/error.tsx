"use client";

import Link from "next/link";

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-w-0 flex-1 px-5 py-10 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-2xl rounded-2xl border border-hairline bg-white p-6 sm:p-8">
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-alert">
          Dashboard error
        </p>
        <h1 className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">
          Something went wrong
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink/65">
          The dashboard could not display this view. No internal details are
          shown. You can try again or return to the overview.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex min-h-11 items-center rounded-full bg-forest px-4 text-sm font-medium text-canvas"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center rounded-full border border-hairline px-4 text-sm font-medium text-ink"
          >
            Back to overview
          </Link>
        </div>
      </div>
    </main>
  );
}
