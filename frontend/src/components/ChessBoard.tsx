import { useState, type CSSProperties } from "react";
import { Chessboard } from "react-chessboard";
import { Chess, type Square } from "chess.js";

type Arrow = [Square, Square, string?];

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

interface ChessBoardProps {
  fen?: string;
  arrows?: Arrow[];
  orientation?: "white" | "black";
  interactive?: boolean;
  onMove?: (sourceSquare: string, targetSquare: string) => boolean;
}

export function ChessBoard({
  fen,
  arrows = [],
  orientation = "white",
  interactive = false,
  onMove,
}: ChessBoardProps) {
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);

  const v5Arrows = arrows.map(([from, to, color]) => ({
    startSquare: from,
    endSquare: to,
    color: color ?? "var(--accent)",
  }));
  const sideToMove = fen?.split(" ")[1] === "b" ? "b" : "w";

  const legalTargets = (() => {
    if (!interactive || !selectedSquare || !fen) {
      return new Set<string>();
    }

    try {
      const chess = new Chess(fen);
      const moves = chess.moves({ square: selectedSquare as Square, verbose: true });
      return new Set(moves.map((m) => m.to));
    } catch {
      return new Set<string>();
    }
  })();

  const highlightStyles: Record<string, CSSProperties> = {};
  if (selectedSquare) {
    highlightStyles[selectedSquare] = {
      backgroundColor: "color-mix(in srgb, var(--accent), transparent 62%)",
    };
  }
  for (const sq of legalTargets) {
    highlightStyles[sq] = {
      background: "radial-gradient(circle, color-mix(in srgb, var(--teal), transparent 55%) 24%, transparent 26%)",
      borderRadius: "50%",
    };
  }

  const isOwnPiece = (pieceType: string) => sideToMove === pieceType[0];

  const handleSquareClick = ({
    piece,
    square,
  }: {
    piece: { pieceType: string } | null;
    square: string;
  }) => {
    if (!interactive) {
      return;
    }

    if (selectedSquare && selectedSquare !== square) {
      if (legalTargets.has(square)) {
        const success = onMove?.(selectedSquare, square) ?? false;
        setSelectedSquare(null);
        if (success) {
          return;
        }
      }

      if (piece && isOwnPiece(piece.pieceType)) {
        setSelectedSquare(square);
        return;
      }

      setSelectedSquare(null);
      return;
    }

    if (piece && isOwnPiece(piece.pieceType)) {
      setSelectedSquare(square);
    } else {
      setSelectedSquare(null);
    }
  };

  return (
    <div className="w-full">
      <Chessboard
        options={{
          position: fen ?? STARTING_FEN,
          boardOrientation: orientation,
          arrows: v5Arrows,
          allowDragging: interactive,
          squareStyles: interactive ? highlightStyles : undefined,
          canDragPiece: interactive
            ? ({ piece }: { piece: { pieceType: string } }) => isOwnPiece(piece.pieceType)
            : undefined,
          onPieceDrop:
            interactive && onMove
              ? ({
                  sourceSquare,
                  targetSquare,
                }: {
                  sourceSquare: string;
                  targetSquare: string | null;
                }) => {
                  if (!targetSquare) {
                    return false;
                  }
                  setSelectedSquare(null);
                  return onMove(sourceSquare, targetSquare);
                }
              : undefined,
          onSquareClick: interactive ? handleSquareClick : undefined,
          onPieceClick: interactive
            ? ({ piece, square }: { piece: { pieceType: string }; square: string | null }) => {
                if (!square) {
                  return;
                }
                handleSquareClick({ piece, square });
              }
            : undefined,
        }}
      />
    </div>
  );
}
