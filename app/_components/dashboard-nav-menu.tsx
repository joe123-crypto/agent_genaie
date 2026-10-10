"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BriefcaseBusiness,
  ClipboardList,
  FileUser,
  Home,
  Menu,
  Settings,
  X,
} from "lucide-react";
import { cvAppHref } from "@/src/lib/cv-app";

export type DashboardSection =
  | "overview"
  | "job-scout"
  | "applications"
  | "settings";

type DashboardNavMenuProps = {
  active: DashboardSection;
  basePath: string;
};

const navItems: ReadonlyArray<{
  key: DashboardSection | "create-cv";
  label: string;
  href: string;
  icon: LucideIcon;
  // Lives in the separate CV app (genaie-cv) rather than under basePath here.
  external?: boolean;
}> = [
  { key: "overview", label: "Overview", href: "", icon: Home },
  { key: "job-scout", label: "Job Scout", href: "/job-scout", icon: BriefcaseBusiness },
  { key: "create-cv", label: "Create CV", href: "/create-cv/interview", icon: FileUser, external: true },
  { key: "applications", label: "Applications", href: "/applications", icon: ClipboardList },
  { key: "settings", label: "Settings", href: "/settings", icon: Settings },
];

export function DashboardNavMenu({ active, basePath }: DashboardNavMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const TriggerIcon = open ? X : Menu;

  return (
    <div className="dashboard-nav-wrap" ref={rootRef}>
      <button
        className="dashboard-nav-trigger"
        type="button"
        ref={buttonRef}
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={open ? "Close dashboard navigation" : "Open dashboard navigation"}
        onClick={() => setOpen((value) => !value)}
      >
        <TriggerIcon aria-hidden="true" />
      </button>
      <nav
        className={open ? "dashboard-nav is-open" : "dashboard-nav"}
        id={menuId}
        aria-label="Primary dashboard navigation"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.key;
          return (
            <a
              key={item.key}
              className={isActive ? "dashboard-nav-link is-active" : "dashboard-nav-link"}
              href={item.external ? cvAppHref(`${basePath}${item.href}`) : `${basePath}${item.href}`}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}
