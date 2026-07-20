import { useEffect, useRef } from "react";

import type { StudySide } from "../types/mistakes";
import { MistakeCapturePanel } from "./mistakes/MistakeCapturePanel";

interface AnalysisMistakeDialogProps {
  open: boolean;
  analysisRunId: string;
  studySide: StudySide;
  players?: { white?: string; black?: string };
  onStudySideChange: (side: StudySide) => void;
  onJumpToMove: (ply: number) => void;
  onOpenLibrary: () => void;
  onClose: () => void;
}

export function AnalysisMistakeDialog({
  open,
  analysisRunId,
  studySide,
  players,
  onStudySideChange,
  onJumpToMove,
  onOpenLibrary,
  onClose,
}: AnalysisMistakeDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="analysis-mistake-dialog-backdrop"
      data-testid="analysis-mistake-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="analysis-mistake-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="analysis-mistake-dialog-title"
      >
        <header className="analysis-mistake-dialog__header">
          <div>
            <span>Completed analysis</span>
            <h2 id="analysis-mistake-dialog-title">Save Mistakes</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="icon-button"
            aria-label="Close Save Mistakes"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="analysis-mistake-dialog__body">
          <MistakeCapturePanel
            analysisRunId={analysisRunId}
            studySide={studySide}
            players={players}
            onStudySideChange={onStudySideChange}
            onJumpToMove={onJumpToMove}
            onOpenLibrary={onOpenLibrary}
            showTitle={false}
          />
        </div>
      </section>
    </div>
  );
}
