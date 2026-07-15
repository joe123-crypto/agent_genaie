import type { ReactNode } from "react";
import {
  BriefcaseBusiness,
  ChevronDown,
  Home,
  Settings,
  Utensils,
  UserRound,
} from "lucide-react";

type DashboardSection = "overview" | "job-scout" | "webetu" | "settings";

type DashboardShellProps = {
  active: DashboardSection;
  children: ReactNode;
  publicUserId: string;
  userLabel?: string | null;
};

const navItems = [
  { key: "overview", label: "Overview", href: "", icon: Home },
  { key: "job-scout", label: "Job Scout", href: "/job-scout", icon: BriefcaseBusiness },
  { key: "webetu", label: "Webetu Reservations", href: "/vault", icon: Utensils },
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
        <a className="dashboard-brand" href={basePath}>
          Genaie Scout
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
        <div className="dashboard-user">
          <span className="dashboard-user-avatar" aria-hidden="true">
            <UserRound />
          </span>
          <span className="dashboard-user-label">{userLabel || "Account"}</span>
          <ChevronDown aria-hidden="true" />
        </div>
      </aside>
      <section className="dashboard-content">{children}</section>
    </main>
  );
}
