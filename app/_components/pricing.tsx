import {
  BriefcaseBusiness,
  CircleCheck,
  Crown,
  Database,
  FileText,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { UserPlan } from "@/src/domains/users";

type PricingFeature = {
  label: string;
  Icon: LucideIcon;
};

export type PricingPlan = {
  id: UserPlan;
  name: string;
  description: string;
  price: string;
  features: PricingFeature[];
  ctaLabel: string;
  ctaHref: string;
  featured?: boolean;
};

export const pricingPlans: PricingPlan[] = [
  {
    id: "free",
    name: "Free Plan",
    description: "Try Genaie to test it in work",
    price: "$0",
    features: [
      { label: "Max 10 applications/month", Icon: BriefcaseBusiness },
      { label: "Limited CV customization", Icon: FileText },
      { label: "Limited sources", Icon: Database },
    ],
    ctaLabel: "Start free",
    ctaHref: "/login",
  },
  {
    id: "pro",
    name: "Pro Plan",
    description: "More applications and stronger profile matching.",
    price: "$5/month",
    features: [
      { label: "Max 30 applications/month", Icon: BriefcaseBusiness },
      { label: "Broad CV customizations", Icon: Sparkles },
      { label: "Unlimited sources", Icon: Database },
    ],
    ctaLabel: "Contact for Pro",
    ctaHref: "mailto:genaie2027@gmail.com?subject=Genaie%20Pro%20Plan",
    featured: true,
  },
  {
    id: "ultra",
    name: "Ultra Plan",
    description: "Highest volume with full application customization.",
    price: "$10/month",
    features: [
      { label: "Max 100 applications/month", Icon: BriefcaseBusiness },
      { label: "Unlimited CV and cover letter customization", Icon: Crown },
      { label: "Unlimited sources", Icon: Database },
    ],
    ctaLabel: "Contact for Ultra",
    ctaHref: "mailto:genaie2027@gmail.com?subject=Genaie%20Ultra%20Plan",
  },
];

type PricingProps = {
  className?: string;
  mode?: "marketing" | "selection";
  nextHref?: string;
  selectedPlan?: UserPlan | null;
  titleId?: string;
};

export function Pricing({
  className = "",
  mode = "marketing",
  nextHref = "/",
  selectedPlan = null,
  titleId = "landing-pricing-title",
}: PricingProps) {
  const sectionClassName = `landing-pricing${className ? ` ${className}` : ""}`;

  return (
    <section
      className={sectionClassName}
      id="pricing"
      aria-labelledby={titleId}
    >
      <div className="landing-pricing-copy">
        <h2 id={titleId}>Choose your job hunt pace</h2>
        <p>
          Start with a focused trial, then scale up when you want more applications
          and deeper customization.
        </p>
      </div>

      <div className="landing-pricing-grid">
        {pricingPlans.map((plan) => {
          const isSelected = selectedPlan === plan.id;

          return (
            <article
              className={`landing-pricing-card${plan.featured ? " is-featured" : ""}${isSelected ? " is-selected" : ""}`}
              key={plan.name}
            >
              <div className="landing-pricing-card-header">
                {plan.featured ? (
                  <Sparkles aria-hidden="true" />
                ) : (
                  <CircleCheck aria-hidden="true" />
                )}
                <div>
                  <h3>{plan.name}</h3>
                  <p>{plan.description}</p>
                </div>
              </div>

              <p className="landing-pricing-price">{plan.price}</p>

              <ul className="landing-pricing-features">
                {plan.features.map(({ label, Icon }) => (
                  <li key={`${plan.name}-${label}`}>
                    <Icon aria-hidden="true" />
                    <span>{label}</span>
                  </li>
                ))}
              </ul>

              {mode === "selection" ? (
                <form className="landing-pricing-form" action="/account/plan/select" method="post">
                  <input type="hidden" name="plan" value={plan.id} />
                  <input type="hidden" name="next" value={nextHref} />
                  <button
                    className={`button landing-pricing-button${plan.featured ? "" : " secondary"}`}
                    type="submit"
                  >
                    {isSelected ? "Continue with this plan" : `Select ${plan.name}`}
                  </button>
                </form>
              ) : (
                <a
                  className={`button landing-pricing-button${plan.featured ? "" : " secondary"}`}
                  href={plan.ctaHref}
                >
                  {plan.ctaLabel}
                </a>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
