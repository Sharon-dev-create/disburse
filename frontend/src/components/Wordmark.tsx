import Image from "next/image";

type WordmarkSize = "sm" | "md";

type WordmarkProps = {
  size?: WordmarkSize;
  className?: string;
};

const SIZES: Record<WordmarkSize, { width: number; height: number }> = {
  sm: { width: 100, height: 22 },
  md: { width: 140, height: 30 },
};

export function Wordmark({ size = "md", className = "" }: WordmarkProps) {
  const { width, height } = SIZES[size];

  return (
    <Image
      src="/disburse-flow-logo.png"
      alt=""
      width={width}
      height={height}
      className={`block max-w-full object-contain ${className}`}
    />
  );
}
