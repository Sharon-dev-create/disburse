import DashboardHeader from "@/components/dashboard/DashboardHeader";

export default function RecipientsPage() {
  return (
    <main className="min-w-0 flex-1">
      <DashboardHeader showTitle={false} />
      <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8 sm:py-10 lg:px-10">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">
            Read-only demo
          </p>
          <h1 className="mt-2 text-3xl font-medium tracking-[-0.05em] text-ink">
            Recipients
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/65">
            Recipient records would be reviewed here in a live workflow. This
            read-only demo does not create, pay, or verify recipients.
          </p>
        </div>

        <section
          aria-labelledby="recipients-empty-heading"
          className="mt-8 rounded-2xl border border-hairline bg-white p-6 sm:p-8"
        >
          <h2
            id="recipients-empty-heading"
            className="text-base font-medium text-ink"
          >
            No recipient records available
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-ink/65">
            There are no recipient records to display in the current read-only
            demo state. No recipients have been added, paid, or verified through
            this interface.
          </p>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-ink/65">
            Destination addresses or format checks, when present in a live
            system, do not verify ownership or payout eligibility and do not
            imply that a transfer or settlement has occurred.
          </p>
        </section>
      </div>
    </main>
  );
}
