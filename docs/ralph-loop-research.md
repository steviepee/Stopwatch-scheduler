# Ralph Loop Research — Chase-H-AI & Best Practices

## Date: February 2026

---

## Who is Chase-H-AI?

**Chase Hannegan** — USMC veteran (MV-22 Osprey pilot), currently pursuing a dual MBA/MS in Computer Science at UChicago Booth. Founder of **Chase AI**, an AI education platform.

- **TikTok:** [@chase_ai_](https://www.tiktok.com/@chase_ai_) (~100K followers)
- **Instagram:** [@chase.h.ai](https://www.instagram.com/chase.h.ai/) (~109K followers)
- **LinkedIn:** [Chase Hannegan](https://www.linkedin.com/in/chasehannegan/)
- **Website:** [chaseai.io](https://www.chaseai.io/)
- **Skool:** [Chase AI Community](https://www.skool.com/chase-ai-community/about) (free), [Chase AI+](https://www.skool.com/chase-ai/about) (paid)
- **Tagline:** "Making AI Simple"

Chase is a **popularizer and educator**, not the original inventor of Ralph loops. That credit goes to **Geoffrey Huntley** ([ghuntley.com/ralph](https://ghuntley.com/ralph/)).

---

## What Are Ralph Loops?

The Ralph Wiggum loop (named after the Simpsons character) is an autonomous AI coding pattern where an LLM agent iterates through tasks in a loop, coding until a completion condition is met.

### The Original (Geoffrey Huntley)

The simplest form:

```bash
while :; do cat PROMPT.md | claude-code ; done
```

Each iteration spawns a fresh Claude Code session that reads instructions, does work, and exits. The loop restarts with a clean context.

---

## Chase's Critical Distinction: "Real" vs "Plugin" Ralph

Chase's key contribution is a viral critique across two TikTok videos:

1. ["Stop Using the Claude Code Ralph Loop Plugin"](https://www.tiktok.com/@chase_ai_/video/7594996794673646903)
2. ["Everyone's hyping the Ralph Wiggum plugin wrong"](https://www.tiktok.com/@chase_ai_/video/7595019450080841015)

### The Core Argument

| Aspect | "Real" Ralph Loop | Plugin Ralph Loop |
|---|---|---|
| **Context** | Fresh session per iteration | Same session, accumulating tokens |
| **Effectiveness** | LLM stays in "smart zone" (0–100K tokens) | Drifts into "dumb zone" (100K+) |
| **Memory** | Files on disk (PRD + progress.md) | Context window (degrades over time) |
| **Implementation** | Bash script as outer loop | Plugin that blocks exit |

### Chase's Exact Words

> "LLMs get dumber as the context fills up. Past ~100k tokens, effectiveness drops hard."
>
> "The REAL Ralph Loop starts a brand new session for every task iteration. Fresh context = smart Claude. Stale context = dumb Claude."
>
> "Real Ralph = new session each iteration. Plugin Ralph = same session until auto-compact. One keeps you smart. One lets you drift into the dumb zone."

---

## Chase's Recommended Architecture

1. **Create a PRD** (Product Requirements Document) with discrete, well-scoped tasks
2. **Use a bash script as the outer loop** — not a plugin running inside the same session
3. **Each iteration spawns a NEW Claude Code session** with fresh context
4. The AI reads the PRD + `progress.md` at the start of each iteration
5. The AI finds the **first incomplete task**, implements it, runs quality checks
6. The AI **updates `progress.md`** with what worked, what failed, and learnings
7. The session **terminates**, and the bash loop starts a new one
8. **Git serves as the memory layer** — all code changes are committed, so the next session sees real codebase state

### The Power Formula

> **Fresh tokens + learned context from previous attempts = consistently high-quality output**

### What NOT to Do

- Do NOT use the Claude Code Ralph Wiggum plugin as a substitute for bash-loop
- Do NOT keep iterating in the same session until auto-compact
- Do NOT rely on the LLM's context window for memory between iterations
- Do NOT make tasks too large — each task should fit comfortably in one context window

---

## Notable Implementations

| Repo | Description |
|---|---|
| [snarktank/ralph](https://github.com/snarktank/ralph) | Most popular (9.8K+ stars). Has `ralph.sh`, `prd.json`, `progress.txt` |
| [frankbria/ralph-claude-code](https://github.com/frankbria/ralph-claude-code) | Autonomous loop with intelligent exit detection |
| [KLIEBHAN/ralph-loop](https://github.com/KLIEBHAN/ralph-loop) | External loop with fresh context per iteration |
| [ghuntley.com/ralph](https://ghuntley.com/ralph/) | The original by Geoffrey Huntley |

---

## Key Takeaways for Our Project

1. **Bash script outer loop** is the correct approach — not the plugin
2. **PRD with discrete tasks** keeps each iteration focused
3. **progress.md** is the inter-session memory — append-only log of successes/failures
4. **CLAUDE.md** (already exists) gives each fresh session project context
5. **Git commits after each iteration** ensure persistent state
6. **Task granularity matters** — each task should be completable in one session

---

## Sources

- [Chase AI TikTok - Stop Using the Plugin](https://www.tiktok.com/@chase_ai_/video/7594996794673646903)
- [Chase AI TikTok - Hyping It Wrong](https://www.tiktok.com/@chase_ai_/video/7595019450080841015)
- [Geoffrey Huntley - Original Ralph](https://ghuntley.com/ralph/)
- [Geoffrey Huntley - Everything is a Ralph Loop](https://ghuntley.com/loop/)
- [snarktank/ralph GitHub](https://github.com/snarktank/ralph)
- [Everyone's Using Ralph Loops Wrong (Substack)](https://sparkryai.substack.com/p/everyones-using-ralph-loops-wrong)
- [Why the Anthropic Ralph Plugin Sucks](https://www.aihero.dev/why-the-anthropic-ralph-plugin-sucks)
- [What Everyone Gets Wrong (Codacy)](https://blog.codacy.com/what-everyone-gets-wrong-about-the-ralph-loop)
- [The Register - Ralph Wiggum loop](https://www.theregister.com/2026/01/27/ralph_wiggum_claude_loops/)
- [VentureBeat - Ralph Wiggum in AI](https://venturebeat.com/technology/how-ralph-wiggum-went-from-the-simpsons-to-the-biggest-name-in-ai-right-now/)
