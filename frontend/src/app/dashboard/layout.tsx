import type { Metadata } from "next";
import { Suspense } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";

export const metadata: Metadata = { title: "Demo dashboard", description: "Illustrative Disburse financial operations dashboard." };

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return <div className="min-h-screen bg-canvas lg:flex"><Suspense fallback={<div className="hidden w-64 shrink-0 border-r border-hairline lg:block" />}><DashboardSidebar /></Suspense>{children}</div>;
}
