import { cleanup, render, screen } from "@testing-library/react";
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
        name: /your personal agent that hunts for jobs while you live your life/i,
      }),
    ).toBeVisible();
    expect(screen.getByText(/applies on your behalf/i)).toBeVisible();
    expect(screen.getByRole("link", { name: /start your job hunt/i })).toHaveAttribute(
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

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "#home");
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
    expect(screen.getByRole("link", { name: /privacy & policy/i })).toHaveAttribute(
      "href",
      "/privacy-policy",
    );
    expect(screen.getByRole("img", { name: /facebook link coming soon/i })).toBeVisible();
    expect(screen.getByRole("img", { name: /whatsapp link coming soon/i })).toBeVisible();

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
