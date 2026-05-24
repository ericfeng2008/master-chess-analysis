interface MoveNavigatorProps {
  onFirst: () => void;
  onBack: () => void;
  onForward: () => void;
  onLast: () => void;
  onFlip: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
}

export function MoveNavigator({
  onFirst,
  onBack,
  onForward,
  onLast,
  onFlip,
  canGoBack,
  canGoForward,
}: MoveNavigatorProps) {
  return (
    <div className="flex items-center gap-1" aria-label="Move navigation">
      <button
        onClick={onFirst}
        disabled={!canGoBack}
        className="icon-button"
        title="Go to start"
        aria-label="Go to start"
      >
        <SkipBackIcon />
      </button>
      <button
        onClick={onBack}
        disabled={!canGoBack}
        className="icon-button"
        title="Step backward"
        aria-label="Step backward"
      >
        <ChevronLeftIcon />
      </button>
      <button
        onClick={onForward}
        disabled={!canGoForward}
        className="icon-button"
        title="Step forward"
        aria-label="Step forward"
      >
        <ChevronRightIcon />
      </button>
      <button
        onClick={onLast}
        disabled={!canGoForward}
        className="icon-button"
        title="Go to end"
        aria-label="Go to end"
      >
        <SkipForwardIcon />
      </button>
      <button onClick={onFlip} className="icon-button" title="Flip board" aria-label="Flip board">
        <FlipIcon />
      </button>
    </div>
  );
}

function SkipBackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 20 9 12l10-8v16Z" />
      <path d="M5 19V5" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function SkipForwardIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 4 10 8-10 8V4Z" />
      <path d="M19 5v14" />
    </svg>
  );
}

function FlipIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3 5 6l3 3" />
      <path d="M5 6h11a3 3 0 0 1 3 3v1" />
      <path d="m16 21 3-3-3-3" />
      <path d="M19 18H8a3 3 0 0 1-3-3v-1" />
    </svg>
  );
}
