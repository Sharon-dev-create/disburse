type WordmarkSize = "sm" | "md";

type WordmarkProps = {
  size?: WordmarkSize;
  className?: string;
};

const SIZES: Record<
  WordmarkSize,
  { mark: number; text: string; gap: string }
> = {
  sm: { mark: 20, text: "text-[15px]", gap: "gap-2" },
  md: { mark: 26, text: "text-[17px]", gap: "gap-2.5" },
};

/**
 * Disburse wordmark: a transfer motif (two opposing arrows) in a forest
 * green tile, next to the logotype.
 */
export function Wordmark({ size = "md", className = "" }: WordmarkProps) {
  const { mark, text, gap } = SIZES[size];

  return (
    <span className={`inline-flex items-center ${gap} ${className}`}>
      <svg
        width={mark}
        height={mark}
        viewBox="0 0 26 26"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect width="26" height="26" rx="7.5" fill="#246B50" />
        <path
          d="M7.75 10.75H16.5M14.25 8.5l2.25 2.25-2.25 2.25M18.25 15.25H9.5M11.75 13l-2.25 2.25 2.25 2.25"
          stroke="#F8F7F3"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={`font-semibold tracking-[-0.02em] text-ink ${text}`}>
        Disburse
      </span>
    </span>
  );
}
