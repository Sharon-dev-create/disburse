"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Search, X } from "lucide-react";
import {
  DESTINATION_NETWORKS,
  demoRecipients,
  formatRecipientDate,
  shortenWalletAddress,
  type PayoutReadiness,
  type RecipientStatus,
} from "@/lib/recipient-demo-data";
import { PayoutReadinessBadge, RecipientStatusBadge } from "./RecipientStatusBadge";

type RecipientStatusFilter = "All statuses" | RecipientStatus;
type ReadinessFilter = "All readiness" | PayoutReadiness;

const RECIPIENT_STATUSES: readonly RecipientStatus[] = ["Active", "Invited", "Inactive"];
const READINESS_STATUSES: readonly PayoutReadiness[] = ["Ready", "Needs attention", "Incomplete"];

function AddressLabel({ address }: { address: string }) {
  return (
    <span className="font-mono text-[11px] text-ink/70" title={address || "Address not provided"}>
      {shortenWalletAddress(address)}
      {address ? <span className="sr-only">. Full address: {address}</span> : null}
    </span>
  );
}

export default function RecipientDirectory() {
  const [query, setQuery] = useState("");
  const [network, setNetwork] = useState("All networks");
  const [recipientStatus, setRecipientStatus] = useState<RecipientStatusFilter>("All statuses");
  const [readiness, setReadiness] = useState<ReadinessFilter>("All readiness");

  const filteredRecipients = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return demoRecipients.filter((recipient) => {
      const matchesQuery =
        !normalizedQuery ||
        recipient.fullName.toLowerCase().includes(normalizedQuery) ||
        recipient.email.toLowerCase().includes(normalizedQuery);
      const matchesNetwork = network === "All networks" || recipient.destinationNetwork === network;
      const matchesStatus = recipientStatus === "All statuses" || recipient.status === recipientStatus;
      const matchesReadiness = readiness === "All readiness" || recipient.payoutReadiness === readiness;
      return matchesQuery && matchesNetwork && matchesStatus && matchesReadiness;
    });
  }, [network, query, readiness, recipientStatus]);

  const hasFilters =
    query.trim() !== "" ||
    network !== "All networks" ||
    recipientStatus !== "All statuses" ||
    readiness !== "All readiness";

  const clearFilters = () => {
    setQuery("");
    setNetwork("All networks");
    setRecipientStatus("All statuses");
    setReadiness("All readiness");
  };

  return (
    <section aria-labelledby="recipient-directory-heading" className="mt-8 overflow-hidden rounded-2xl border border-hairline bg-white">
      <div className="border-b border-hairline px-5 py-5 sm:px-6">
        <h2 id="recipient-directory-heading" className="text-base font-medium text-ink">Recipient directory</h2>
        <p className="mt-1 text-xs text-ink/65">Wallet addresses are shown in shortened form; open a profile to inspect the full address.</p>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="relative md:col-span-2 xl:col-span-1">
            <label htmlFor="recipient-search" className="sr-only">Search recipients by name or email</label>
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist" />
            <input
              id="recipient-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name or email"
              className="min-h-11 w-full rounded-lg border border-hairline bg-canvas pl-9 pr-3 text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
            />
          </div>
          <div>
            <label htmlFor="recipient-network-filter" className="sr-only">Filter by destination network</label>
            <select
              id="recipient-network-filter"
              value={network}
              onChange={(event) => setNetwork(event.target.value)}
              className="min-h-11 w-full rounded-lg border border-hairline bg-white px-3 text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
            >
              <option>All networks</option>
              {DESTINATION_NETWORKS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="recipient-status-filter" className="sr-only">Filter by recipient status</label>
            <select
              id="recipient-status-filter"
              value={recipientStatus}
              onChange={(event) => setRecipientStatus(event.target.value as RecipientStatusFilter)}
              className="min-h-11 w-full rounded-lg border border-hairline bg-white px-3 text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
            >
              <option>All statuses</option>
              {RECIPIENT_STATUSES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="recipient-readiness-filter" className="sr-only">Filter by payout readiness</label>
            <select
              id="recipient-readiness-filter"
              value={readiness}
              onChange={(event) => setReadiness(event.target.value as ReadinessFilter)}
              className="min-h-11 w-full rounded-lg border border-hairline bg-white px-3 text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
            >
              <option>All readiness</option>
              {READINESS_STATUSES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-3 flex min-h-8 flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="text-xs text-ink/65">
            Showing {filteredRecipients.length} of {demoRecipients.length} demonstration recipients
          </p>
          {hasFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-forest underline underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
            >
              <X size={13} aria-hidden="true" />
              Clear filters
            </button>
          ) : null}
        </div>
      </div>

      {filteredRecipients.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <h3 className="text-sm font-medium text-ink">No recipients match these filters</h3>
          <p className="mt-2 text-sm text-ink/65">Try another name, email address, network, or status.</p>
          {hasFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-4 min-h-10 rounded-full border border-hairline px-4 text-sm font-medium text-forest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto xl:block">
            <table className="w-full min-w-[1050px] border-collapse text-left">
              <caption className="sr-only">Demonstration recipient contact and payout configuration records</caption>
              <thead className="border-b border-hairline bg-canvas text-[9px] font-medium uppercase tracking-[0.12em] text-mist">
                <tr>
                  <th scope="col" className="px-5 py-3">Recipient</th>
                  <th scope="col" className="px-3 py-3">Destination network</th>
                  <th scope="col" className="px-3 py-3">Wallet/account</th>
                  <th scope="col" className="px-3 py-3">Preferred token</th>
                  <th scope="col" className="px-3 py-3">Campaigns</th>
                  <th scope="col" className="px-3 py-3">Recipient status</th>
                  <th scope="col" className="px-3 py-3">Payout readiness</th>
                  <th scope="col" className="px-5 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline text-xs">
                {filteredRecipients.map((recipient) => (
                  <tr key={recipient.id}>
                    <th scope="row" className="px-5 py-4 font-normal">
                      <span className="block font-medium text-ink">{recipient.fullName}</span>
                      <span className="mt-1 block text-ink/65">{recipient.email}</span>
                    </th>
                    <td className="px-3 py-4 text-ink">{recipient.destinationNetwork}</td>
                    <td className="px-3 py-4"><AddressLabel address={recipient.walletAddress} /></td>
                    <td className="px-3 py-4 text-ink">{recipient.preferredToken}</td>
                    <td className="px-3 py-4 text-ink">{recipient.associatedCampaignIds.length}</td>
                    <td className="px-3 py-4"><RecipientStatusBadge status={recipient.status} /></td>
                    <td className="px-3 py-4"><PayoutReadinessBadge status={recipient.payoutReadiness} /></td>
                    <td className="px-5 py-4">
                      <Link
                        href={`/dashboard/recipients/${recipient.id}`}
                        className="inline-flex items-center gap-1 font-medium text-forest underline decoration-forest/30 underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
                      >
                        View <ArrowUpRight size={13} aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-hairline xl:hidden">
            {filteredRecipients.map((recipient) => (
              <li key={recipient.id} className="px-5 py-5 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-ink">{recipient.fullName}</h3>
                    <p className="mt-1 break-all text-xs text-ink/65">{recipient.email}</p>
                    <p className="mt-2"><AddressLabel address={recipient.walletAddress} /></p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <RecipientStatusBadge status={recipient.status} />
                    <PayoutReadinessBadge status={recipient.payoutReadiness} />
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3">
                  <div><dt className="text-ink/65">Destination network</dt><dd className="mt-1 font-medium text-ink">{recipient.destinationNetwork}</dd></div>
                  <div><dt className="text-ink/65">Preferred token</dt><dd className="mt-1 font-medium text-ink">{recipient.preferredToken}</dd></div>
                  <div><dt className="text-ink/65">Associated campaigns</dt><dd className="mt-1 font-medium text-ink">{recipient.associatedCampaignIds.length}</dd></div>
                  <div><dt className="text-ink/65">Added</dt><dd className="mt-1 font-medium text-ink">{formatRecipientDate(recipient.createdAt)}</dd></div>
                </dl>
                <Link
                  href={`/dashboard/recipients/${recipient.id}`}
                  className="mt-4 inline-flex min-h-10 items-center gap-1 text-xs font-medium text-forest underline decoration-forest/30 underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
                >
                  View recipient details <ArrowUpRight size={13} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
