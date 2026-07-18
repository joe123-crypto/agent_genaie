import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";

import AboutPage from "@/app/about/page";

describe("About page", () => {
  afterEach(cleanup);

  it("presents the developer motivation and primary actions", () => {
    render(createElement(AboutPage));

    expect(
      screen.getByRole("heading", { name: /we are what we do/i }),
    ).toBeVisible();
    expect(
      screen.getByText(/first for himself, then for close friends and family/i),
    ).toBeVisible();
    expect(
      screen.getByText(/the work we do defines us more than anything/i),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: /start your job hunt/i })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: /back home/i })).toHaveAttribute("href", "/");
  });
});
