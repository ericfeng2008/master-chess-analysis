"""Data models and constants for the chess analysis pipeline.

Contains the dataclass definitions used throughout the analysis system:
- CTIResult: Output of a single-position CTI computation
- AnalysisMoveData: Full per-move analysis result with all metrics
- AnalysisProgressEvent / AnalysisCompleteEvent: SSE streaming event payloads

Also defines tuning constants that control depth selection, position
skipping, and EPE move selection.
"""

from dataclasses import dataclass
import chess

# --------------------------------------------------------------------
# Analysis depth and position-skipping constants
# --------------------------------------------------------------------

# Depth for the Phase 1 probe in density-based adaptive MultiPV.
# A cheap shallow search to estimate how moves cluster before the full-depth pass.
PROBE_DEPTH = 8

# Floor for analysis depth. Even heavily lopsided positions get at least this depth
# so that move ordering and PV extraction remain reliable.
MIN_ANALYSIS_DEPTH = 10

# Positions where |eval| >= this threshold (in pawns) are considered fully decided.
# EPE computation is skipped for these; the raw eval is used instead.
SKIP_EVAL_THRESHOLD = 8.0

# --------------------------------------------------------------------
# EPE (Expected Practical Evaluation) move-selection constants
# --------------------------------------------------------------------

# Stop adding candidate moves once cumulative Maia probability reaches this fraction.
# Ensures we cover the vast majority of what a human would realistically play.
EPE_CUMULATIVE_CUTOFF = 0.95

# Hard cap on the number of candidate moves considered for EPE, even if
# the cumulative probability hasn't reached the cutoff yet.
EPE_MAX_MOVES = 5

# CTI evaluates the smallest Maia-probability prefix that reaches this target.
# Any unevaluated tail becomes an explicit uncertainty interval.
CTI_POLICY_COVERAGE = 0.995


@dataclass
class CTIResult:
    """Result of computing the Critical Tension Index for a single position.

    CTI measures how hard a position is for a human to play correctly:
    CTI = 1 - sum(maia_probability for each move in set S),
    where set S is the set of moves within ``acceptable_drop`` of the best eval.

    Attributes:
        cti: The CTI value in [0, 1], or None if the position was skipped.
            High values mean humans are unlikely to find a good move.
        good_moves: Evaluated moves in set S (within acceptable_drop of best
            eval). This list is not necessarily exhaustive while CTI is approximate.
        best_eval: Eval of the best move, from side-to-move perspective.
        best_mate: Mate-in-N from side-to-move perspective, or None if no forced mate.
        all_evals: Map of every evaluated move to its eval (side-to-move perspective).
        maia_policy: Maia probability distribution over all legal moves.
        best_pv: Principal variation (sequence of moves) for the best move.
        cti_lower_bound/cti_upper_bound: Formal interval caused by unevaluated
            Maia policy mass. Equal when the result is exact.
    """

    cti: float | None
    cti_lower_bound: float
    cti_upper_bound: float
    cti_remaining_mass: float
    cti_is_approximate: bool
    good_moves: list[chess.Move]
    best_eval: float
    best_mate: int | None
    all_evals: dict[chess.Move, float]
    maia_policy: dict[chess.Move, float]
    best_pv: list[chess.Move]


@dataclass
class AnalysisMoveData:
    """Complete analysis result for a single move in the game.

    Combines all computed metrics (CTI, MBI, EIG, BRI, EPE) and supporting
    data into one record. One instance is produced per half-move (ply).

    Attributes:
        move_number: Full-move number (1-based, increments every two plies).
        side: ``"white"`` or ``"black"`` -- who is to move in this position.
        move: The move actually played, in SAN notation (e.g., ``"Nf3"``).
        fen: FEN of the position BEFORE the move is played.
        stockfish_eval: Pre-move eval (best eval from multi-PV search of this
            position). Normalized to White's perspective.
        eval_after: Post-move eval (eval of the position AFTER this move).
            Populated in a post-processing pass as stockfish_eval[i+1].
            Normalized to White's perspective. This is the value the UI displays.
        cti: Critical Tension Index for this position, or None if skipped.
        best_move: Stockfish's best move in SAN, or None if the position was skipped.
        good_moves: Evaluated moves in set S (within acceptable_drop of best),
            in SAN. May omit low-probability roots when CTI is approximate.
        good_moves_with_eval: Map of good moves (SAN) to their eval drop from best
            (negative or zero values; 0.0 = the best move itself).
        is_minefield: True if CTI exceeds the minefield_threshold.
        mbi_classification: MBI category for this move if it was a blunder:
            ``"cognitive_trap"``, ``"random_oversight"``,
            ``"unclassified_blunder"``, or None.
        mbi_maia_prob: Maia probability of the played blunder move, or None.
        eig_value: Engine-Intuition Gap -- absolute eval difference between
            Stockfish's best move and Maia's top-predicted move.
        is_eig_flagged: True if eig_value >= eig_threshold.
        is_brilliant: True if the played move is the engine's best move AND
            Maia assigns it very low probability (< bri_threshold).
        bri_maia_prob: Maia probability of the played move when it is the best
            move, or None if the played move wasn't the best.
        epe_score: Expected Practical Evaluation -- probability-weighted eval
            over the most likely human replies (1-ply lookahead).
        best_line: Stockfish principal variation (up to 6 moves) in SAN.
        best_line_evals: Pre-computed evaluation data for each position in
            best_line, keyed by FEN. Each value is a dict with:
            eval (White's perspective), best_move (SAN),
            good_moves (SAN list), good_moves_with_eval (diff dict),
            mate_in (int or None). Enables instant display of
            variation position info without on-demand API calls.
        mate_in: Mate-in-N from White's perspective after this move, or None.
            Positive = White is mating, negative = Black is mating.
    """

    move_number: int
    side: str
    move: str
    fen: str
    stockfish_eval: float
    eval_after: float
    cti: float | None
    cti_lower_bound: float | None
    cti_upper_bound: float | None
    cti_remaining_mass: float | None
    cti_is_approximate: bool
    best_move: str | None
    good_moves: list[str]
    good_moves_with_eval: dict[str, float]
    is_minefield: bool
    mbi_classification: str | None
    mbi_maia_prob: float | None
    eig_value: float | None
    is_eig_flagged: bool
    is_brilliant: bool
    bri_maia_prob: float | None
    epe_score: float | None
    best_line: list[str]
    best_line_evals: dict[str, dict]
    mate_in: int | None


@dataclass
class AnalysisProgressEvent:
    """SSE progress event emitted periodically during game analysis.

    Attributes:
        moves_analyzed: Number of half-moves processed so far.
        total_moves: Total number of half-moves in the game.
        minefields_found: Running count of positions flagged as minefields.
    """

    moves_analyzed: int
    total_moves: int
    minefields_found: int


@dataclass
class AnalysisCompleteEvent:
    """SSE completion event emitted once all moves have been analyzed.

    Attributes:
        moves: Full list of per-move analysis results.
        minefields: Indices (0-based) into ``moves`` that are flagged as minefields.
    """

    moves: list[AnalysisMoveData]
    minefields: list[int]
