# Master Chess Game Analyzer

Master Chess Game Analyzer is a local chess-analysis and training application. Import a PGN to review a game with objective engine evaluation and human move-likelihood modelling, then save the mistakes worth revisiting for later study and practice.

It combines:

- **Stockfish**, a strong open-source chess engine, for objective position evaluation. Stockfish searches for the best continuations, scores positions in pawn-equivalent evaluations, and identifies which candidate moves preserve or lose objective value.
- **Maia3-79M**, a history-aware neural-network model for predicting human chess moves. Maia3 considers the current position, recent position history, and separate player/opponent Elo ratings to estimate the probability of every legal move. It lets the analyzer distinguish positions that are objectively difficult from moves that merely look unusual to the engine. Learn more in the [Maia3 GitHub repository](https://github.com/CSSLab/maia3) and the [Maia3 Hugging Face collection](https://huggingface.co/collections/MaiaChess/maia3).

Analysis runs locally on your machine: no account, cloud synchronization, or game data sent externally.

## From Analysis to Practice

The application goes beyond showing the best move and evaluation. It combines Stockfish and Maia3 to identify practical, reviewable mistakes:

- **High-CTI mistakes**: a player missed an acceptable move in a position that was difficult for humans to solve.
- **Human-natural blunders**: objective blunders that Maia3 classified as cognitive traps because the move was natural for the selected Elo context.

After analysis, you explicitly select which suggested mistakes to save. The selected records and their evidence are stored in the local SQLite database, where you can later review the decision position, add notes and tags, and practice it without rerunning the analysis.

## Analysis at a Glance

| Metric | What It Measures |
|---|---|
| **CTI** (Critical Tension Index) | Practical difficulty of finding a good move |
| **Minefield** | Flags positions where CTI exceeds a threshold |
| **MBI** (Master Blunder Index) | Classifies blunders by human likelihood |
| **EIG** (Engine-Intuition Gap) | Divergence between engine and human preference |
| **BRI** (Brilliancy) | Objectively strong moves that humans rarely find |

For a complete explanation of these metrics, configuration guidance, and the review/practice workflow, see the [User Guide](./UserGuide.md).

## Analysis Time and Performance

Full-game analysis is **CPU-bound** and will usually take longer than using Stockfish alone. In addition to Stockfish searches, this application evaluates most of the human players' moves with Maia3.

As one reference point, analyzing an 80-ply game at Stockfish depth 18 takes about **5–6 minutes** on a MacBook Pro with an 18-core M5 Pro CPU. Treat this as an estimate, not a guarantee: game length, engine depth, CPU performance, and other settings all affect the time required.

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

### Windows (Ubuntu WSL only)

Native Windows setup is not supported. If you already have Ubuntu in Windows Subsystem for Linux (WSL), open an Ubuntu WSL terminal and follow the **Linux (Ubuntu/Debian)** commands above. Stockfish is required; install it in Ubuntu WSL before starting the application:

```bash
sudo apt-get update
sudo apt-get install -y stockfish
```

Clone the project into the WSL Linux filesystem—such as a directory under `~/`—rather than a Windows-mounted path such as `/mnt/c/`; this avoids avoidable filesystem overhead. Once both services are running in WSL, open `http://localhost:5173` in your Windows browser.

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

Open **http://localhost:5173** in your browser.

### Environment Variables

If your engines are installed in non-default locations, or you want to tune engine performance, set these environment variables before starting the backend. All variables use the `ANALYSIS_` prefix.

| Variable | Default | Description |
|---|---|---|
| `ANALYSIS_STOCKFISH_PATH` | `/opt/homebrew/bin/stockfish` | Path to Stockfish binary |
| `ANALYSIS_DEFAULT_ENGINE_DEPTH` | `18` | Backend fallback Stockfish search depth (12-28; higher = more accurate but slower) |
| `ANALYSIS_STOCKFISH_THREADS` | `0` (auto) | CPU threads for Stockfish (`0` = auto-detect: `cpu_count - 1`) |
| `ANALYSIS_STOCKFISH_HASH_MB` | `256` | Stockfish hash table size in MB (more = better for deep analysis) |
| `ANALYSIS_STOCKFISH_SEARCH_CACHE_ENTRIES` | `2048` | Maximum exact process-local Stockfish best/root search results retained in the LRU cache (`0` disables it) |
| `ANALYSIS_DATA_DIR` | `backend/data` | Directory for the local game and Mistake Library SQLite database |

Example:

```bash
export ANALYSIS_STOCKFISH_PATH=/usr/games/stockfish
./run-backend.sh
```

## User Guide

Read the [User Guide](./UserGuide.md) for the complete workflow: importing and analyzing a game, understanding metrics before changing configuration, reviewing results, saving mistakes, using the local libraries, and practicing saved positions.

## License

This project uses the [MIT license](./LICENSE).
