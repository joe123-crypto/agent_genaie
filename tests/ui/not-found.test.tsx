import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";

vi.mock("next/image", () => ({
  default: ({
    src,
    priority: _priority,
    ...props
  }: {
    src: string | { src: string };
    priority?: boolean;
    alt: string;
  }) =>
    createElement("img", {
      ...props,
      src: typeof src === "string" ? src : src.src,
    }),
}));

import NotFound from "@/app/not-found";

describe("custom 404 page", () => {
  afterEach(cleanup);

  it("presents the missing page message with a home link", () => {
    render(createElement(NotFound));

    expect(screen.getByRole("heading", { name: "404" })).toBeVisible();
    expect(screen.getByText("Something's missing.")).toBeVisible();
    expect(
      screen.getByText("This page is missing or you assembled the link incorrectly."),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: /go home/i })).toHaveAttribute("href", "/");
    expect(screen.getByRole("img", { name: /personalized 404 illustration/i })).toBeVisible();
  });
});
