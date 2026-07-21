import type { ReactNode } from "react";
import Image from "next/image";
import {
  BriefcaseBusiness,
  Home,
  Settings,
} from "lucide-react";
import { DashboardAccountMenu } from "@/app/_components/dashboard-account-menu";

type DashboardSection = "overview" | "job-scout" | "webetu" | "settings";

type DashboardShellProps = {
  active: DashboardSection;
  children: ReactNode;
  publicUserId: string;
  userLabel?: string | null;
};

// Webetu is hidden from navigation (pending extraction into its own project);
// the vault page stays reachable by direct URL with active="webetu".
const navItems = [
  { key: "overview", label: "Overview", href: "", icon: Home },
  { key: "job-scout", label: "Job Scout", href: "/job-scout", icon: BriefcaseBusiness },
  { key: "settings", label: "Settings", href: "/settings", icon: Settings },
] as const;

export function DashboardShell({
  active,
  children,
  publicUserId,
  userLabel = "Account",
}: DashboardShellProps) {
  const basePath = `/${publicUserId}`;

  return (
    <main className="dashboard-app">
      <aside className="dashboard-sidebar" aria-label="Dashboard navigation">
        <a className="dashboard-brand" href={basePath} aria-label="Genaie home">
          <Image src="/logo.png" alt="Genaie" width={1045} height={283} />
        </a>
        <nav className="dashboard-nav" aria-label="Primary dashboard navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.key;
            return (
              <a
                key={item.key}
                className={isActive ? "dashboard-nav-link is-active" : "dashboard-nav-link"}
                href={`${basePath}${item.href}`}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>
        <DashboardAccountMenu userLabel={userLabel} />
      </aside>
      <section className="dashboard-content">{children}</section>
    </main>
  );
}
