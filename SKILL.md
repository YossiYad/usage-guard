---
name: usage-guard
description: >-
  Track how much Claude Code usage is left in this session (5-hour window,
  weekly quota, and context-window fill) and manage work so it never gets cut
  off mid-change. Use at the start of any significant task, before every git
  commit, and whenever the user asks "how much usage is left?", "how much more
  can we push?", or anything similar. Always stops in a clean, committable
  state. Never invents usage numbers - if data is unavailable it says so and
  works only from the context-window estimate.
---

# usage-guard

Keep an eye on remaining usage and stop work in a clean state before any limit
cuts a change off halfway.

## Thresholds (edit these to taste)

All decision logic reads from these constants. Change a number here and the
behaviour below changes with it.

```
SNAPSHOT_MAX_AGE_SECONDS = 180   # snapshot older than this -> fall back to API
FIVE_HOUR_WARN_PCT       = 70    # warn up front on large tasks; finish current unit then consult
FIVE_HOUR_STOP_PCT       = 85    # hard stop: checkpoint commit, update RESUME.md, do not start anything new
SEVEN_DAY_HIGH_PCT       = 80    # weekly quota considered "high" -> warn up front on large tasks
CONTEXT_COMPACT_PCT      = 75    # suggest /compact or commit + new session
CONTEXT_STOP_PCT         = 80    # hard stop on context fill
```

## Honesty rules (non-negotiable)

- Never show a percentage unless it was read from a real source (`snapshot` or
  `api`).
- If `usage-check` reports `source=unavailable`, say so plainly and fall back to
  the live context-window fill from `/context`. Do not guess the 5-hour or
  weekly numbers.
- The oauth usage endpoint is unofficial and may change or disappear. Treat a
  failure as `unavailable`, never as 0%.

## When this skill applies

- At the start of every significant work task (multi-file or multi-step).
- Before every `git commit`.
- Whenever the user asks how much usage is left, how much more can be pushed in
  this session, when the window resets, or anything similar.

## How to read the numbers

Run the helper and read its `key=value` output.

- Windows (PowerShell):
  `powershell -NoProfile -File "%USERPROFILE%\.claude\skills\usage-guard\scripts\usage-check.ps1"`
- WSL / Linux / macOS:
  `~/.claude/skills/usage-guard/scripts/usage-check`

Output fields:

```
source=snapshot|api|unavailable
five_hour_pct=<int|unknown>
seven_day_pct=<int|unknown>
context_pct=<int|unknown>
five_hour_resets_at=<iso|unknown>
seven_day_resets_at=<iso|unknown>
snapshot_age_seconds=<int|unknown>
note=<human-readable reason / context>
```

`source=snapshot` is the preferred, no-network path (written by the status
line). `source=api` means the snapshot was missing or stale and the numbers came
from the unofficial endpoint; on this path `context_pct` is `unknown` - read it
live from `/context` instead. `source=unavailable` means neither worked: report
the `note`, and manage the session from `/context` alone.

## Decision logic

### At the start of a task

1. Run `usage-check`.
2. Estimate task size (number of files / steps).
3. If the task is large AND (`five_hour_pct >= FIVE_HOUR_WARN_PCT` OR
   `seven_day_pct >= SEVEN_DAY_HIGH_PCT`): warn the user up front that we will
   probably not finish everything this session. Propose splitting the work into
   stages where every stage ends with a clean commit.

### While working - budget in commit-sized units

- Always work in commit-sized units: one complete, buildable/runnable change at
  a time.
- Do not start a new unit if it likely cannot be finished before hitting a stop
  threshold.

### Approaching a threshold

- `five_hour_pct >= FIVE_HOUR_STOP_PCT` OR `context_pct >= CONTEXT_STOP_PCT`:
  **Stop now.** Make a clean checkpoint commit of whatever is ready, update
  `RESUME.md`, and do not start anything else.
- `five_hour_pct >= FIVE_HOUR_WARN_PCT` (but below stop): finish only the
  current unit, commit it, then stop and consult the user before continuing.
- `context_pct >= CONTEXT_COMPACT_PCT`: suggest `/compact`, or a commit plus a
  fresh session, so context is not lost.

When `source=unavailable`, apply only the `context_pct` rules using the live
`/context` reading, and tell the user the 5-hour / weekly numbers are
unavailable.

## Checkpoint -> RESUME.md

At every checkpoint (any stop above, or before ending a session mid-task),
create or update `RESUME.md` at the project root with:

- What was completed.
- The latest commit (hash + subject).
- The exact next unit of work.
- Relevant files and decisions.

The goal: a fresh session can continue from `RESUME.md` without the user having
to re-explain anything.

## Data sources, in priority order

1. **Local snapshot** at `~/.claude/usage-snapshot.json`, written by the status
   line wrapper (`scripts/statusline-snapshot.mjs`) from the `rate_limits` and
   `context_window` fields Claude Code streams on Pro/Max plans. Preferred, no
   network call.
2. **Unofficial oauth usage endpoint** (`GET /api/oauth/usage`) using the token
   in `~/.claude/.credentials.json` (`claudeAiOauth.accessToken`). Used only
   when the snapshot is missing or older than `SNAPSHOT_MAX_AGE_SECONDS`.
3. **Unavailable** - if both fail, work from `/context` only and say the usage
   numbers are unavailable.

`scripts/usage-check.ps1` (Windows) and `scripts/usage-check` (WSL/Linux/macOS)
implement this whole fallback chain.
