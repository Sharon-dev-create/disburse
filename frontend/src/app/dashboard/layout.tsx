import type { Metadata } from "next";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";

export const metadata: Metadata = { title: "Demo dashboard", description: "Illustrative Disburse financial operations dashboard." };

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return <div className="min-h-screen bg-canvas lg:flex"><DashboardSidebar />{children}</div>;
}
