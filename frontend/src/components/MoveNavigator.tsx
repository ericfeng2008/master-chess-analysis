interface MoveNavigatorProps {
  onFirst: () => void;
  onBack: () => void;
  onForward: () => void;
  onLast: () => void;
  onFlip: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
}

const btnClass =
  "rounded bg-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50";

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
    <div className="flex items-center gap-1">
      <button onClick={onFirst} disabled={!canGoBack} className={btnClass} title="Go to start">
        ⏮
      </button>
      <button onClick={onBack} disabled={!canGoBack} className={btnClass} title="Step backward">
        ◀
      </button>
      <button onClick={onForward} disabled={!canGoForward} className={btnClass} title="Step forward">
        ▶
      </button>
      <button onClick={onLast} disabled={!canGoForward} className={btnClass} title="Go to end">
        ⏭
      </button>
      <button onClick={onFlip} className={btnClass} title="Flip board">
        ⇅
      </button>
    </div>
  );
}
