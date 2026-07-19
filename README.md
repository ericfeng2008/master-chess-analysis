# Master Chess Game Analyzer

Master Chess Game Analyzer is a chess game analysis tool for reviewing PGN games with both objective engine evaluation and human move-likelihood modeling. It combines:

- **Stockfish**, a strong open-source chess engine, for objective position evaluation. Stockfish searches for the best continuations, scores positions in pawn-equivalent evaluations, and identifies which candidate moves preserve or lose objective value.
- **Maia3-79M**, a history-aware neural-network chess model for human move prediction. Maia3 uses the current position, recent position history, and separate player/opponent Elo ratings to estimate the probability of every legal move.

Together, Stockfish and Maia compute a suite of analysis metrics that go beyond traditional engine analysis.

Rather than just showing the best move and evaluation, Master Chess Game Analyzer answers practical questions:
- How hard is this position for a human?
- Is a blunder a natural mistake or a random oversight?
- Does the engine's recommendation match human intuition?
- Was a move brilliantly unintuitive?

### How It Works

By combining objective evaluation from Stockfish with human move probabilities from Maia, the analyzer answers questions that neither approach can answer alone:

- **"How hard is this position?"** If Stockfish says only 2 moves are good, and Maia says humans would play one of those 2 moves 90% of the time, the position is easy (low CTI). If Maia says humans would almost never find the good moves, the position is a minefield (high CTI).
- **"Was this blunder a natural mistake?"** If Maia predicts that many players in the selected Elo context would choose the bad move, it is a **Cognitive Trap** — a genuinely tricky position worth studying. A low-probability error is less characteristic of that Maia population, but the model does not diagnose the individual player's cause.
- **"Does the engine disagree with human intuition?"** A high **Engine-Intuition Gap (EIG)** means the computer's best move is very different from what humans naturally choose. These are positions where game analysis can reveal non-obvious resources.
- **"What eval should I realistically expect?"** **EPE** predicts the actual position value assuming the opponent plays like a human, not like a computer. This is often more useful for practical game review than the raw engine eval.

Analysis runs locally on your machine — no cloud services, no data sent externally.

## Analysis Metrics

| Metric | What It Measures |
|---|---|
| **CTI** (Critical Tension Index) | Practical difficulty of finding a good move |
| **Minefield** | Flags positions where CTI exceeds a threshold |
| **MBI** (Master Blunder Index) | Classifies blunders by human likelihood |
| **EIG** (Engine-Intuition Gap) | Divergence between engine and human preference |
| **BRI** (Brilliancy) | Objectively strong moves that humans rarely find |
| **EPE** (Expected Practical Evaluation) | Eval weighted by likely human responses |


## Prerequisites

### macOS (Homebrew)

```bash
# Node.js and Python
brew install node python pipenv

# Chess engine
brew install stockfish
```

### Linux (Ubuntu/Debian)

```bash
# Node.js (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Python
sudo apt-get install -y python3 python3-pip
pip3 install pipenv

# Stockfish
sudo apt-get install -y stockfish

```

## Setup

```bash
# Clone the repository
git clone https://github.com/ericfeng2008/master-chess-analysis.git
cd master-chess-analysis

# Install backend dependencies
cd backend
pipenv install
cd ..

# Install frontend dependencies
cd frontend
npm install
cd ..
```

### Download the Maia3 Model

The Maia3 checkpoint is approximately 316 MB and is intentionally not committed to this repository. Before starting the backend:

1. Open the [Maia3-79M checkpoint page](https://huggingface.co/UofTCSSLab/Maia3-79M/blob/main/maia3-79m.pt).
2. Use the page's download control and verify that the downloaded file is named `maia3-79m.pt` rather than an HTML page.
3. Create the repository-relative model directory if it does not exist, then place the file at `backend/model/maia3-79m.pt`:

```bash
mkdir -p backend/model
# Copy or move the downloaded file to:
# backend/model/maia3-79m.pt
```

The checkpoint path is Git-ignored. If the file is missing or has a different name, backend startup stops with a missing-checkpoint error that identifies the expected path.

## Running the Application

### Quick Start

```bash
# Terminal 1: Start backend (port 8099)
./run-backend.sh

# Terminal 2: Start frontend (port 5173)
./run-frontend.sh
```

### Manual Start

```bash
# Backend
cd backend
pipenv run uvicorn app.main:app --reload --host localhost --port 8099

# Frontend
cd frontend
npm run dev
```

Open **http://localhost:5173** in your browser.

### Environment Variables

If your engines are installed in non-default locations, or you want to tune engine performance, set these environment variables before starting the backend. All variables use the `ANALYSIS_` prefix.

| Variable | Default | Description |
|---|---|---|
| `ANALYSIS_STOCKFISH_PATH` | `/opt/homebrew/bin/stockfish` | Path to Stockfish binary |
| `ANALYSIS_DEFAULT_ENGINE_DEPTH` | `12` | Backend fallback Stockfish search depth (higher = more accurate but slower) |
| `ANALYSIS_STOCKFISH_THREADS` | `0` (auto) | CPU threads for Stockfish (`0` = auto-detect: `cpu_count - 1`) |
| `ANALYSIS_STOCKFISH_HASH_MB` | `256` | Stockfish hash table size in MB (more = better for deep analysis) |
| `ANALYSIS_DATA_DIR` | `backend/data` | Directory for the local game and Mistake Library SQLite database |

Example:

```bash
export ANALYSIS_STOCKFISH_PATH=/usr/games/stockfish
./run-backend.sh
```

## Usage Guide

### 1. Upload a PGN File

Click **Upload PGN File** next to the move navigator below the chess board. Select a `.pgn` file containing exactly one game. The application parses it, saves it to the local database immediately, and displays its mainline in the PGN viewer. Multi-game files are rejected explicitly rather than silently analyzing only their first game.

Games are recognized from chess content, not filenames or PGN decoration. The local identity is a versioned SHA-256 fingerprint of the complete initial FEN plus the ordered mainline moves in UCI. Headers, result text, whitespace, comments, annotations, clocks, and side variations do not change that identity. Importing an equivalent PGN therefore reopens the existing logical game and automatically restores its newest saved analysis and settings without running Stockfish or Maia.

### 2. Configure Analysis Parameters

The **Analysis Configuration** panel displays 8 configurable sliders organized in two columns.

The game information area also provides separate **White Maia3** and **Black Maia3** Elo controls. Both default to `2200`; select the ratings that best represent each player before starting analysis.

**Left column:**
- **Stockfish Engine Depth** (10-20, default 12): Higher depth = more accurate but slower analysis
- **CTI: Acceptable Drop** (0.1-2.0, default 0.5): Maximum eval drop (in pawns) for a move to count as "good" in CTI computation
- **CTI: Minefield Threshold** (0.50-1.00, default 0.80): CTI value above which a position is flagged as a minefield
- **MBI: Blunder Threshold** (0.5-3.0, default 1.0): Minimum eval drop (in pawns) to classify a move as a blunder

**Right column:**
- **MBI: Trap Probability** (10%-80%, default 40%): Maia probability above which a blunder is a "Cognitive Trap"
- **MBI: Outlier Probability** (1%-20%, default 5%): Maia probability below which a blunder is a "Random Oversight"
- **EIG: Gap Threshold** (0.5-5.0, default 2.0): Minimum eval difference (in pawns) to flag an Engine-Intuition Gap
- **BRI: Brilliancy Threshold** (1%-20%, default 5%): Maximum Maia probability for a best move to qualify as "Brilliant"

### 3. Run Analysis

Click **Analyze** to start. A progress bar shows positions analyzed and minefields found. Analysis can be canceled at any time.

Completed analyses are immutable versions of the game. Cache compatibility includes every result-affecting setting, the Stockfish and Maia runtime identities, and the result schema version. Clicking **Analyze** with an exact previously completed configuration restores that version without engine work. Changing depth, thresholds, Elo context, or another result-affecting setting creates a new version. The **Analysis history** control identifies versions by date, depth, and runtime provenance and can restore any of them instantly.

### 4. Navigate Results

After analysis completes:

- **Chart**: Click any point on the evaluation chart to jump to that move. Use the **White Player** / **Black Player** toggle above the chart to filter CTI lines and markers by perspective.
- **Move Navigator**: Use the arrow buttons below the board to step through moves.
- **PGN Viewer**: Click any move in the PGN notation to navigate there. Stockfish best continuations for blunders appear inline in bold green parenthesized notation `(...)`. User-explored variations appear in teal bracket notation `[...]`.
- **Chess Board**: Updates automatically to show the position for the selected move. After analysis, a thin vertical evaluation bar beside the main board visualizes that exact position's White-versus-Black balance. Hover over the bar to reveal only its compact White-perspective value: signed pawn scores such as `+1.25` or `-2.50`, signed mate values such as `#3` or `#-2`, and terminal results `1-0` or `0-1`. Explored and Stockfish-variation positions use a neutral striped bar with a `pending` tooltip while their ad-hoc evaluation runs, never a stale mainline value. The segment order flips with the board without changing the score's perspective. Click the flip button to change board orientation. After analysis, drag or click pieces to explore alternative moves.
- **Position Info**: Shows detailed metrics for the selected move including eval, CTI, minefield status, MBI classification, EIG, BRI, and EPE.

### 5. Explore Alternative Moves

After analysis completes, the board becomes interactive. You can test "what if" lines:

- **Drag a piece** or **click a piece then click its target** to play an alternative move. If the move matches the mainline, navigation advances normally. If it differs, exploration mode begins.
- **Exploration mode**: A teal "Explored" badge appears in Position Info. Each explored move is evaluated by Stockfish at the configured analysis depth, showing eval, best move, and good moves. CTI is shown only for mainline analyzed positions. Continue playing moves to explore deeper.
- **Multiple lines**: Explored lines are saved when you exit or start a new exploration. The PGN viewer shows all saved explorations grouped by branch point. Lines sharing a common prefix are merged into a single block.
- **Stockfish variation details**: Click any move in a Stockfish best-line variation `(...)` to see its evaluation (eval, best move, good moves) with a "Variation" badge. These evaluations are pre-computed during batch analysis and display instantly without additional engine calls.
- **Arrow keys**: Left/Right arrow keys navigate within the active exploration or variation. At the first move, Left exits back to the mainline.
- **Exit**: Press **Escape**, click any mainline move, or click the chart to exit exploration/variation mode.
- **Game Info**: Click "Show game info" above the PGN viewer to display PGN metadata (Event, Site, Date, players, Elo, ECO, etc.). The panel auto-hides when you click anywhere else on the page.

### 6. Save Mistakes Worth Revisiting

After analysis completes, the **Mistakes to revisit** panel reads the persisted result for the selected White or Black side. It suggests only the union of:

- **High-CTI mistake** — the played move lost at least the configured acceptable drop and the CTI lower bound met the configured minefield threshold.
- **Human-natural blunder** — MBI classified the objective blunder as a cognitive trap because Maia3 assigned the played move at least the configured trap probability in the selected Elo context.

A high-CTI position is not saved when the player found an acceptable move. One position matching both reasons appears once with both system labels. Approximate CTI uses its lower bound, so an uncertainty interval that crosses the threshold is not promoted as a definite minefield.

Choose **White** or **Black** under **Mistake made by**. Either side can represent you or your opponent; no player profile is required. Review the compact suggestions and select **Save selected mistakes**. Saving is explicit and duplicate-safe. The completed game analysis and full normalized PGN are already stored locally even when no suggestion is saved.

Re-analysis shows only additional mistakes. A played decision is recognized across analysis versions from the game fingerprint, ply, side, decision FEN, and played UCI move—not from evaluation, best move, or CTI values that may change at a new depth. Active and archived Mistake Library items both suppress the same decision from later capture suggestions. Existing notes, tags, evidence, lifecycle, and practice attempts are never overwritten by re-analysis; deleting an item allows that decision to be suggested again.

Maia likelihood is a model-estimated probability that a player in the selected White/Black Elo context would choose the move. It is not an observed percentage of real players.

### 7. Use the Local Mistake Library

Open **Mistake Library** from the analyzer header. The library is a game-oriented tournament notebook rather than a profile or diagnosis dashboard:

- Filter explicitly by player name across the White and Black PGN headers, while searching event, played move, and note text separately.
- Filter by the player who made the mistake, `High-CTI mistake`, `Human-natural blunder`, one of your tags, archive state, or last practice result. Filters can be combined.
- Inspect the original decision board, played move, best and acceptable moves, objective loss, CTI interval, Maia likelihood/Elo context, analysis depth, and stored best line.
- Add your own note and multiple case-insensitive tags. Remove tags as chips, choose suggested tags, or enter custom ones. Suggested tags include Candidate generation, Calculation horizon, Opponent resource, Resulting-position evaluation, Strategic plan, Opening memory, Defensive resource, Time management, and Execution. These are optional player labels; the application never asserts them as the cause.
- Archive, restore, or delete a saved mistake without deleting its game.
- Choose **Open full game** to restore the stored PGN, complete result timeline, analysis settings, and saved position without uploading or analyzing again.

System capture reasons are immutable. Notes and tags are player-owned. Lists are paginated and read only stored SQLite data; browsing does not run Stockfish or Maia.

### 8. Practice Saved Mistakes

Start practice from the current filtered view, an explicit selection, or one mistake. Filtering by a tag and choosing **Practice this view** creates a bounded tag-focused practice queue.

1. **Think** — The board opens at the original decision position from the saved side. The played mistake, best move, CTI/MBI verdict, objective loss, and continuation remain hidden. Play a legal move on the board, enter SAN, or explicitly Reveal without a move.
2. **Reveal** — Compare your move with the played mistake, best and acceptable moves, objective loss, CTI interval, Maia played-move likelihood/Elo context, and stored best line.
3. Choose **Again** or **Understood**. The application stores the submitted move, objective acceptability, outcome, and date.

There are no points, streaks, hints, four-grade scheduling, leeches, inferred weaknesses, or engagement rewards. The library can filter `Again` positions when you want another pass.

Practice shortcuts:

| Key | Action |
|---|---|
| `R` | Reveal the current position |
| `1` | Again |
| `2` | Understood |
| `Escape` | Return to the Mistake Library |

### Local Game Library

Every valid one-game PGN is saved locally as soon as it is uploaded. **Open Saved Game** opens a searchable, filterable library as an overlay in the current analyzer workspace: choose All, Analyzed, or Not analyzed games, sort by recently opened, recently added, or players, preview a row, then explicitly open it. Opening an analyzed game restores its preferred saved result and history without starting the engines; opening an unanalyzed game restores its PGN and clears the prior analysis state so it is ready to analyze.

The library labels games from effective Tournament/Event, White, and Black values. A manual value takes precedence over a retained usable imported PGN value, which in turn takes precedence over a missing value. Uploading an equivalent PGN can fill a previously missing imported value, but never overwrites a manual correction. Use **Edit details** from Game Info or the library preview to correct these fields; clearing a manual value falls back to the imported value. Raw PGN and analysis-run headers remain unchanged as provenance.

Game identity is deliberately based on the initial position and ordered mainline moves, not PGN headers or file name. Thus two files with identical chess content are one local game even if their event or player details differ. This makes repeat imports and cached analysis restoration reliable, but it cannot distinguish separately played games that have exactly the same initial position and move sequence.

### Storage, Migration, and Privacy

Games, versioned analyses, saved mistakes, tags, and attempts use `backend/data/master-chess-analysis.db` by default. Existing databases are upgraded transactionally to schema 6. Before upgrading an existing schema, the backend creates a sibling backup named like `master-chess-analysis.db.pre-v5-to-v6.bak`. Analysis runs are grouped by the canonical game fingerprint, while unparsable legacy rows remain preserved and are reported as non-cacheable instead of being deleted.

Legacy saved mistakes are replayed against their game mainline to backfill stable played-decision identities. If equivalent analysis runs already contain duplicate saved mistakes, migration keeps a deterministic canonical item, unions tags and attempts, preserves distinct notes and evidence in traceable migration metadata, and records retired IDs. Items that cannot be validated safely remain untouched and are reported for diagnosis.

If persistence is unavailable, a valid PGN can still be viewed and analyzed in memory. The UI displays a warning and does not claim that the import or result was saved; cache history remains unavailable until local persistence recovers.

Deleting a saved mistake removes only that mistake's tag links and minimal attempt history. The complete analysis run and PGN remain. Back up the SQLite file while the backend is stopped if it contains valuable study data.

Everything stays on the local machine. There is no account, cloud synchronization, sharing, coach surveillance, opponent profile, leaderboard, LLM coaching, or live-game feature.

## Understanding the Analysis Metrics

### CTI (Critical Tension Index)

**Range**: 0.0 to 1.0

CTI measures how hard it is for a human to find a good move. It works by asking: "What fraction of the move probability mass (according to Maia) falls on objectively good moves (according to Stockfish)?"

- **CTI = 0.0**: All moves that Maia considers likely are objectively good. Easy position.
- **CTI = 0.85**: 85% of the probability mass falls on moves that are not within the acceptable drop of the best move. Very difficult for humans.
- **CTI = 1.0**: No move that humans are likely to play is objectively acceptable. Extremely hard.

CTI applies to any position regardless of evaluation. A position can be +5.0 in White's favor and still have high CTI if the winning moves are hard to find.

For performance, CTI evaluates Stockfish roots covering at least 99.5% of Maia3's move probability and reports the small unevaluated tail as an uncertainty interval. Approximate values use an `≈` marker; positions near the minefield threshold are refined until their classification is unambiguous.

**Chart display**: Green line (White's moves), orange line (Black's moves).

### Minefield

**Type**: Binary flag (Yes/No)

A position is flagged as a minefield when its CTI exceeds the minefield threshold (default 0.80). Minefields represent dangerous positions where a strong player is likely to go wrong.

**Chart display**: Colored circles on the CTI line:
- Green circle: Player found the best move in a minefield
- Orange circle: Player found a good (but not best) move
- Red circle: Player missed all good moves

### MBI (Master Blunder Index)

**Type**: Classification (or `null` if not a blunder)

When a move loses more than the blunder threshold in eval, MBI classifies the blunder into one of three categories using Maia's prediction:

- **Cognitive Trap** (diamond marker): Maia probability > trap threshold. The bad move "looks natural" — even a neural network trained on human games would play it. These are the most instructive blunders for post-game review.
- **Random Oversight** (X marker): Maia probability < outlier threshold. The bad move is unexpected even for humans — a mouse slip or momentary lapse.
- **Unclassified Blunder** (outline diamond): Maia probability falls between the two thresholds.

**Chart display**: Fuchsia diamonds (cognitive traps), red X marks (random oversights), fuchsia outline diamonds (unclassified).

### EIG (Engine-Intuition Gap)

**Range**: 0.0+ pawns

EIG measures the eval difference between Stockfish's best move and Maia's most probable move. A high EIG means the engine strongly disagrees with human intuition.

- **EIG = 0.0**: Engine and humans agree on the best move
- **EIG = 2.5 (Flagged)**: Engine's best move is 2.5 pawns better than what humans would naturally play

Positions with high EIG are where engine-assisted analysis can reveal the biggest practical opportunities.

**Chart display**: Cyan squares when EIG exceeds the threshold.

### BRI (Brilliancy)

**Type**: Boolean flag

A move is flagged as brilliant when it is the engine's best move and has a very low Maia probability (below the brilliancy threshold). These are objectively strong moves that humans almost never find.

**Chart display**: Gold stars.

### EPE (Expected Practical Evaluation)

**Range**: Same as eval (pawns, White's perspective)

EPE predicts the actual evaluation you can expect after the opponent's next move, assuming they play according to human tendencies (as modeled by Maia). Instead of assuming best play, EPE uses a **1-ply lookahead**:

1. Predict the opponent's most likely responses using Maia (top moves covering 95% cumulative probability, capped at 5 moves).
2. Evaluate each resulting position with Stockfish.
3. Compute the probability-weighted average. Residual probability mass (moves outside the top N) is assigned the worst-case eval among evaluated moves — pessimistic for the opponent.

`EPE = sum over opponent responses R: Maia_prob(R) * Stockfish_eval(position after R)`

If EPE is significantly higher than the raw eval after White's move, it means Black is likely to respond suboptimally — a practical advantage. If EPE is lower after White's move, Black's natural moves happen to be strong. The alternating perspective creates a characteristic swing pattern on the chart: EPE tends to be optimistic for the side that just moved (because the opponent is human).

**Chart display**: Dashed purple line overlaid on the eval area chart.

### Best Line

The Stockfish principal variation (up to 6 half-moves) showing the recommended continuation. Displayed in the PGN viewer as inline variations for positions where the played move was a blunder.

### Mate Detection

When a forced checkmate exists, the position info shows `#N` (White mates in N) or `#-N` (Black mates in N) instead of a numeric eval.

## Configuration Reference

### Analysis Parameters (UI Sliders)

| Parameter | Default | Range | Description |
|---|---|---|---|
| Stockfish Engine Depth | 12 | 10-20 | Search depth for Stockfish analysis |
| CTI: Acceptable Drop | 0.5 | 0.1-2.0 | Max eval drop (pawns) for a move to be "good" |
| CTI: Minefield Threshold | 0.80 | 0.50-1.00 | CTI above this flags a minefield |
| MBI: Blunder Threshold | 1.0 | 0.5-3.0 | Min eval drop (pawns) to classify as blunder |
| MBI: Trap Probability | 40% | 10%-80% | Maia probability above which a blunder is a Cognitive Trap |
| MBI: Outlier Probability | 5% | 1%-20% | Maia probability below which a blunder is a Random Oversight |
| EIG: Gap Threshold | 2.0 | 0.5-5.0 | Min eval gap (pawns) to flag an Engine-Intuition Gap |
| BRI: Brilliancy Threshold | 5% | 1%-20% | Max Maia probability for best move to be "Brilliant" |
| White Maia3 Elo | 2200 | 2000, 2200, 2400, 2600 | White player's rating context for Maia3 |
| Black Maia3 Elo | 2200 | 2000, 2200, 2400, 2600 | Black player's rating context for Maia3 |

## License

This project uses [MIT license](./LICENSE).
