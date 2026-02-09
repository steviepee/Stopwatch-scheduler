# Ralph Loop — Session Instructions

You are an autonomous AI coding agent working on the Stopwatch Scheduler project.
You are in a Ralph loop — each session is fresh with no prior context beyond these files.

## Your Workflow

1. **Read context files** (in this order):
   - `CLAUDE.md` — project structure, tech stack, API reference
   - `prd.md` — task list with statuses
   - `progress.md` — what previous iterations attempted, learned, and failed at

2. **Find the first PENDING task** in `prd.md`

3. **Implement it:**
   - Write clean, minimal code that satisfies the acceptance criteria
   - Follow existing patterns in the codebase (check similar files first)
   - Do NOT over-engineer or add features beyond the task scope
   - Do NOT modify unrelated code

4. **Verify your work:**
   - Ensure TypeScript compiles without errors (`npx tsc --noEmit` in frontend/)
   - Ensure Python has no syntax errors
   - Run any relevant tests
   - Manually verify the feature works if possible

5. **Update tracking files:**
   - Mark the task as DONE in `prd.md` (change `PENDING` to `DONE`)
   - Check off completed acceptance criteria in `prd.md`
   - Append an entry to `progress.md` with:
     - Iteration number
     - Which task you worked on
     - What you did
     - What worked / what failed
     - Any learnings for future iterations

6. **Commit your changes:**
   - Stage all relevant files
   - Write a clear commit message describing the change
   - Do NOT push to remote

7. **Exit** — the bash loop will start a fresh session for the next task

## Rules

- ONE task per session. Do not attempt multiple tasks.
- If a task is blocked or unclear, mark it as BLOCKED in prd.md with a note, and move to the next PENDING task.
- If you fail after a genuine attempt, document what went wrong in progress.md so the next iteration can try differently.
- Do NOT delete or rewrite progress.md — only APPEND to it.
- Keep changes minimal and focused. Smaller diffs are better.
