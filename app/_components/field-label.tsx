import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type FieldLabelProps = {
  icon: LucideIcon;
  children: ReactNode;
};

export function FieldLabel({ icon: Icon, children }: FieldLabelProps) {
  return (
    <span className="field-label">
      <Icon aria-hidden="true" />
      {children}
    </span>
  );
}
