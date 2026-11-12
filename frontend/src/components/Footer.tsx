import { Wordmark } from "./Wordmark";

export default function Footer() {
  return (
    <footer className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-7 text-xs text-ink/70 sm:flex-row sm:items-center sm:justify-between sm:px-8">
      <a href="#top" aria-label="Disburse home" className="w-fit transition-opacity hover:opacity-75">
        <Wordmark size="sm" />
      </a>
      <p>Campaign funding and payouts, made clearer.</p>
    </footer>
  );
}
