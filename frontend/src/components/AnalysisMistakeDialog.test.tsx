import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnalysisMistakeDialog } from "./AnalysisMistakeDialog";

const api = { get: vi.fn(), save: vi.fn() };

vi.mock("../api/mistakes", () => ({
  getMistakeSuggestions: (...args: unknown[]) => api.get(...args),
  saveMistakes: (...args: unknown[]) => api.save(...args),
}));

const baseProps = () => ({
  open: true,
  analysisRunId: "run-1",
  studySide: "white" as const,
  players: { white: "Master", black: "Opponent" },
  onStudySideChange: vi.fn(),
  onJumpToMove: vi.fn(),
  onOpenLibrary: vi.fn(),
  onClose: vi.fn(),
});

describe("AnalysisMistakeDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ items: [], study_side: "white" });
  });

  it("renders the White/Black mistake perspective inside one modal window", () => {
    const props = baseProps();
    render(<AnalysisMistakeDialog {...props} />);

    const dialog = screen.getByRole("dialog", { name: "Save Mistakes" });
    expect(dialog).toHaveClass("analysis-mistake-dialog");
    expect(screen.getByRole("button", { name: "White" })).toHaveAttribute("data-active", "true");
    fireEvent.click(screen.getByRole("button", { name: "Black" }));
    expect(props.onStudySideChange).toHaveBeenCalledWith("black");
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("supports close, Escape, and backdrop dismissal", () => {
    const props = baseProps();
    const { unmount } = render(<AnalysisMistakeDialog {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Close Save Mistakes" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(2);

    fireEvent.mouseDown(screen.getByTestId("analysis-mistake-dialog-backdrop"));
    expect(props.onClose).toHaveBeenCalledTimes(3);

    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("stays absent before a completed analysis opens it", () => {
    const props = baseProps();
    render(<AnalysisMistakeDialog {...props} open={false} />);
    expect(screen.queryByRole("dialog", { name: "Save Mistakes" })).not.toBeInTheDocument();
  });
});
