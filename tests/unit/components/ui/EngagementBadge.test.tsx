import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EngagementBadge } from "@/components/ui/EngagementBadge";

describe("EngagementBadge", () => {
  it("renders High engagement in green", () => {
    render(<EngagementBadge level="High" />);
    const badge = screen.getByText("High");
    expect(badge).toBeInTheDocument();
    expect(badge.style.background).toBe("rgb(209, 250, 229)");
    expect(badge.style.color).toBe("rgb(6, 95, 70)");
  });

  it("renders Medium engagement in amber", () => {
    render(<EngagementBadge level="Medium" />);
    const badge = screen.getByText("Medium");
    expect(badge.style.background).toBe("rgb(254, 215, 170)");
  });

  it("renders Low engagement in red", () => {
    render(<EngagementBadge level="Low" />);
    const badge = screen.getByText("Low");
    expect(badge.style.background).toBe("rgb(254, 202, 202)");
  });

  it("renders Unknown in grey fallback", () => {
    render(<EngagementBadge level="Unknown" />);
    const badge = screen.getByText("Unknown");
    expect(badge.style.background).toBe("rgb(243, 244, 246)");
  });

  it("renders None in grey fallback", () => {
    render(<EngagementBadge level="None" />);
    const badge = screen.getByText("None");
    expect(badge.style.background).toBe("rgb(243, 244, 246)");
  });

  it("falls back to unknown style for unrecognised level", () => {
    render(<EngagementBadge level="Stellar" />);
    const badge = screen.getByText("Stellar");
    expect(badge.style.background).toBe("rgb(243, 244, 246)");
  });
});
