#!/usr/bin/env bash
#
# ralph.sh — "Real" Ralph Loop for Stopwatch Scheduler
#
# Spawns a fresh Claude Code session per iteration.
# Each session reads PROMPT.md, picks up the next PENDING task from prd.md,
# implements it, updates progress.md, commits, and exits.
# The loop then starts a new session with fresh context.
#
# Usage:
#   chmod +x ralph.sh
#   ./ralph.sh              # Run until all tasks are DONE
#   ./ralph.sh --max 5      # Run at most 5 iterations
#   ./ralph.sh --dry-run    # Show what would happen without running
#

set -euo pipefail

# --- Configuration ---
MAX_ITERATIONS=30
DRY_RUN=false
PROMPT_FILE="PROMPT.md"
PRD_FILE="prd.md"
PROGRESS_FILE="progress.md"
MODEL="claude-sonnet-4-6"

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case $1 in
    --max)
      MAX_ITERATIONS="$2"
      shift 2
      ;;
    --model)
      MODEL="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      echo "Usage: ./ralph.sh [--max N] [--model MODEL] [--dry-run] [-h|--help]"
      echo ""
      echo "Options:"
      echo "  --max N       Maximum iterations (default: 30)"
      echo "  --model MODEL Claude model ID (default: claude-sonnet-4-6)"
      echo "  --dry-run     Show status without running"
      echo "  -h, --help    Show this help"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# --- Helpers ---
pending_count() {
  grep -c "Status:.*PENDING" "$PRD_FILE" 2>/dev/null || echo 0
}

done_count() {
  grep -c "Status:.*DONE" "$PRD_FILE" 2>/dev/null || echo 0
}

blocked_count() {
  grep -c "Status:.*BLOCKED" "$PRD_FILE" 2>/dev/null || echo 0
}

timestamp() {
  date "+%Y-%m-%d %H:%M:%S"
}

# --- Pre-flight checks ---
if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "ERROR: $PROMPT_FILE not found. Run from the project root."
  exit 1
fi

if [[ ! -f "$PRD_FILE" ]]; then
  echo "ERROR: $PRD_FILE not found."
  exit 1
fi

if ! command -v claude &>/dev/null; then
  echo "ERROR: 'claude' CLI not found. Install Claude Code first."
  exit 1
fi

# --- Status ---
echo "========================================="
echo "  Ralph Loop — Stopwatch Scheduler"
echo "========================================="
echo "  Pending:  $(pending_count)"
echo "  Done:     $(done_count)"
echo "  Blocked:  $(blocked_count)"
echo "  Max iter: $MAX_ITERATIONS"
echo "  Model:    $MODEL"
echo "========================================="
echo ""

if [[ "$DRY_RUN" == true ]]; then
  echo "[DRY RUN] Would start Ralph loop. Exiting."
  exit 0
fi

if [[ $(pending_count) -eq 0 ]]; then
  echo "No PENDING tasks found. Nothing to do!"
  exit 0
fi

# --- Main Loop ---
iteration=0

while [[ $iteration -lt $MAX_ITERATIONS ]]; do
  iteration=$((iteration + 1))
  remaining=$(pending_count)

  if [[ $remaining -eq 0 ]]; then
    echo ""
    echo "========================================="
    echo "  All tasks complete! Exiting Ralph loop."
    echo "  Total iterations: $iteration"
    echo "  Done:    $(done_count)"
    echo "  Blocked: $(blocked_count)"
    echo "========================================="
    exit 0
  fi

  echo ""
  echo "-----------------------------------------"
  echo "  Iteration $iteration / $MAX_ITERATIONS"
  echo "  Remaining tasks: $remaining"
  echo "  Started: $(timestamp)"
  echo "-----------------------------------------"
  echo ""

  # Spawn a fresh Claude Code session with the prompt
  # --print mode sends the prompt and gets a response without interactive mode
  # The prompt file tells Claude to read CLAUDE.md, prd.md, and progress.md
  claude --model "$MODEL" --print "$(cat "$PROMPT_FILE")" || {
    echo ""
    echo "[WARN] Claude session exited with non-zero status at $(timestamp)"
    echo "       Continuing to next iteration..."
    echo ""
  }

  echo ""
  echo "  Iteration $iteration finished at $(timestamp)"

  # Brief pause between iterations to avoid rate limiting
  sleep 2
done

echo ""
echo "========================================="
echo "  Reached max iterations ($MAX_ITERATIONS)"
echo "  Pending:  $(pending_count)"
echo "  Done:     $(done_count)"
echo "  Blocked:  $(blocked_count)"
echo "========================================="
