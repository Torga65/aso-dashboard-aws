import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HealthBar } from "@/components/ui/HealthBar";

// jsdom normalises hex colours to rgb() when reading back inline styles
// Component structure: outerDiv[0] > trackDiv[1] > filledBarDiv[2]

describe("HealthBar", () => {
  it("shows the score value by default", () => {
    render(<HealthBar score={75} />);
    expect(screen.getByText("75")).toBeInTheDocument();
  });

  it("hides the score value when showValue=false", () => {
    render(<HealthBar score={75} showValue={false} />);
    expect(screen.queryByText("75")).not.toBeInTheDocument();
  });

  it("uses green color for score >= 70", () => {
    const { container } = render(<HealthBar score={70} />);
    const bar = container.querySelectorAll("div")[2]; // filled bar (index 2)
    expect(bar.style.background).toBe("rgb(34, 197, 94)"); // #22c55e
  });

  it("uses orange color for score between 40 and 69", () => {
    const { container } = render(<HealthBar score={50} />);
    const bar = container.querySelectorAll("div")[2];
    expect(bar.style.background).toBe("rgb(249, 115, 22)"); // #f97316
  });

  it("uses red color for score below 40", () => {
    const { container } = render(<HealthBar score={30} />);
    const bar = container.querySelectorAll("div")[2];
    expect(bar.style.background).toBe("rgb(239, 68, 68)"); // #ef4444
  });

  it("clamps bar width to 0% for negative scores", () => {
    const { container } = render(<HealthBar score={-10} />);
    const bar = container.querySelectorAll("div")[2];
    expect(bar.style.width).toBe("0%");
  });

  it("clamps bar width to 100% for scores above 100", () => {
    const { container } = render(<HealthBar score={150} />);
    const bar = container.querySelectorAll("div")[2];
    expect(bar.style.width).toBe("100%");
  });

  it("renders bar width equal to score within range", () => {
    const { container } = render(<HealthBar score={60} />);
    const bar = container.querySelectorAll("div")[2];
    expect(bar.style.width).toBe("60%");
  });

  it("uses correct text color for score >= 70", () => {
    render(<HealthBar score={80} />);
    const value = screen.getByText("80");
    expect(value.style.color).toBe("rgb(22, 163, 74)"); // #16a34a
  });
});
