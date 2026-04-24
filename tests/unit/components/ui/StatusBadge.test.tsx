import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "@/components/ui/StatusBadge";

describe("StatusBadge", () => {
  it("renders the status text", () => {
    render(<StatusBadge status="Active" />);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("applies green styles for Active", () => {
    render(<StatusBadge status="Active" />);
    const badge = screen.getByText("Active");
    expect(badge.style.background).toBe("rgb(220, 252, 231)");
    expect(badge.style.color).toBe("rgb(22, 101, 52)");
  });

  it("applies amber styles for At-Risk", () => {
    render(<StatusBadge status="At-Risk" />);
    const badge = screen.getByText("At-Risk");
    expect(badge.style.background).toBe("rgb(254, 243, 199)");
  });

  it("applies red styles for Churned", () => {
    render(<StatusBadge status="Churned" />);
    const badge = screen.getByText("Churned");
    expect(badge.style.background).toBe("rgb(254, 226, 226)");
  });

  it("applies blue styles for Onboarding", () => {
    render(<StatusBadge status="Onboarding" />);
    const badge = screen.getByText("Onboarding");
    expect(badge.style.background).toBe("rgb(219, 234, 254)");
  });

  it("applies blue styles for Pre-Production", () => {
    render(<StatusBadge status="Pre-Production" />);
    const badge = screen.getByText("Pre-Production");
    expect(badge.style.background).toBe("rgb(219, 234, 254)");
  });

  it("applies grey fallback for unknown statuses", () => {
    render(<StatusBadge status="Pending" />);
    const badge = screen.getByText("Pending");
    expect(badge.style.background).toBe("rgb(243, 244, 246)");
  });

  it("forwards className prop", () => {
    render(<StatusBadge status="Active" className="test-class" />);
    expect(screen.getByText("Active")).toHaveClass("test-class");
  });
});
