import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Disburse — Move money with confidence",
    template: "%s · Disburse",
  },
  description:
    "Manage campaign funding, control budgets and track every payout in one place. Transparent, controlled campaign payments for platforms.",
};

export const viewport: Viewport = {
  themeColor: "#f8f7f3",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {/*
          Scroll-reveal sections are hidden until IntersectionObserver runs.
          Without JavaScript, this keeps all content visible.
        */}
        <noscript>
          <style>{`.reveal{opacity:1 !important;transform:none !important;}`}</style>
        </noscript>
      </body>
    </html>
  );
}
