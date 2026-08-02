import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";

vi.mock("next/image", () => ({
  default: ({ src, priority: _priority, ...props }: {
    src: string | { src: string };
    priority?: boolean;
    alt: string;
  }) => createElement("img", {
    ...props,
    src: typeof src === "string" ? src : src.src,
  }),
}));

import RootPage from "@/app/page";

describe("Genaie Scout landing page", () => {
  afterEach(cleanup);

  it("presents the primary message and sign-in call to action", () => {
    render(createElement(RootPage));

    expect(
      screen.getByRole("heading", {
        name: /applying for a job shouldn't be a full-time job/i,
      }),
    ).toBeVisible();
    expect(screen.getByText(/applies on your behalf/i)).toBeVisible();
    expect(screen.getByRole("link", { name: /get started/i })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(
      screen.getByRole("img", {
        name: /robot assistant holding documents and a suitcase/i,
      }),
    ).toBeVisible();
  });

  it("includes the expected navigation and animation-ready artwork", () => {
    const { container } = render(createElement(RootPage));
    const primaryNavigation = within(
      screen.getByRole("navigation", { name: /primary navigation/i }),
    );
    const legalFooterNavigation = within(
      screen.getByRole("navigation", { name: /legal footer links/i }),
    );

    expect(primaryNavigation.getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "#home",
    );
    expect(primaryNavigation.getByRole("link", { name: "About" })).toHaveAttribute(
      "href",
      "/about",
    );
    expect(primaryNavigation.getByRole("link", { name: "Pricing" })).toHaveAttribute(
      "href",
      "#pricing",
    );
    expect(primaryNavigation.queryByRole("link", { name: /privacy & policy/i })).toBeNull();
    expect(primaryNavigation.queryByRole("link", { name: /terms of service/i })).toBeNull();
    expect(legalFooterNavigation.getByRole("link", { name: /privacy policy/i })).toHaveAttribute(
      "href",
      "/privacy-policy",
    );
    expect(legalFooterNavigation.getByRole("link", { name: /terms of service/i })).toHaveAttribute(
      "href",
      "/terms-of-service",
    );
    const socialChannels = within(screen.getByRole("list", { name: /social channels/i }));
    expect(
      socialChannels.getByRole("link", { name: /genaie on facebook/i }),
    ).toHaveAttribute("href", "https://www.facebook.com/share/1E5NjcoGSd/");
    expect(socialChannels.getByRole("link", { name: /genaie on x/i })).toHaveAttribute(
      "href",
      "https://x.com/joseph_mun4335",
    );
    expect(
      socialChannels.getByRole("link", { name: /genaie on whatsapp/i }),
    ).toHaveAttribute("href", "https://wa.me/213563719936");
    expect(socialChannels.getByRole("link", { name: /email genaie/i })).toHaveAttribute(
      "href",
      "mailto:genaie2027@gmail.com",
    );

    const scene = container.querySelector(".landing-scene");
    expect(scene).toBeInTheDocument();
    expect(scene?.querySelectorAll(".landing-line").length).toBeGreaterThan(5);
    expect(scene?.querySelectorAll(".landing-dot")).toHaveLength(3);
  });

  it("presents the pricing plans below the how-to section", () => {
    render(createElement(RootPage));

    const howToHeading = screen.getByRole("heading", { name: /see it in action/i });
    const pricingHeading = screen.getByRole("heading", {
      name: /choose your job hunt pace/i,
    });

    expect(
      howToHeading.compareDocumentPosition(pricingHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(screen.getByRole("heading", { name: /free plan/i })).toBeVisible();
    expect(screen.getByText(/try genaie to test it in work/i)).toBeVisible();
    expect(screen.getByText("$0")).toBeVisible();
    expect(screen.getByText(/max 10 applications\/month/i)).toBeVisible();
    expect(screen.getByText(/limited cv customization/i)).toBeVisible();
    expect(screen.getByText(/^limited sources$/i)).toBeVisible();

    expect(screen.getByRole("heading", { name: /pro plan/i })).toBeVisible();
    expect(screen.getByText("$5/month")).toBeVisible();
    expect(screen.getByText(/max 30 applications\/month/i)).toBeVisible();
    expect(screen.getByText(/broad cv customizations/i)).toBeVisible();

    expect(screen.getByRole("heading", { name: /ultra plan/i })).toBeVisible();
    expect(screen.getByText("$10/month")).toBeVisible();
    expect(screen.getByText(/max 100 applications\/month/i)).toBeVisible();
    expect(
      screen.getByText(/unlimited cv and cover letter customization/i),
    ).toBeVisible();
    expect(screen.getAllByText(/unlimited sources/i)).toHaveLength(2);

    expect(screen.getByRole("link", { name: /start free/i })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: /contact for pro/i })).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:genaie2027@gmail.com"),
    );
    expect(screen.getByRole("link", { name: /contact for ultra/i })).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:genaie2027@gmail.com"),
    );
  });
});
