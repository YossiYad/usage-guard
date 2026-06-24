# usage-guard

<p align="center">
  <img src="assets/banner.jpg" alt="Running on empty at the usage pump" width="480">
</p>

A Claude Code skill that keeps track of how much usage you have left in a
session and manages the work so it never gets cut off in the middle of an
incomplete change.

In every session it tries to know three things:

- **5-hour window** utilization
- **weekly (7-day) quota** utilization
- **context-window fill** level

and it uses those numbers to budget work in commit-sized units, warn you before
a limit is reached, and always stop in a clean state that can be committed -
writing a `RESUME.md` so a fresh session can pick up exactly where it left off.

> **Warning - unofficial endpoint.** The fallback that reads usage from
> `GET https://api.anthropic.com/api/oauth/usage` is **unofficial**. It is not a
> documented, supported API and it may change or stop working at any time. When
> it fails, the skill reports `unavailable` (never a fake number) and falls back
> to the context-window estimate from `/context`.

## How it works

Three data sources, in priority order:

1. **Local snapshot** (`~/.claude/usage-snapshot.json`) - written by a status
   line wrapper from the `rate_limits.five_hour`, `rate_limits.seven_day`, and
   `context_window` fields that Claude Code streams to the status line on
   Pro/Max plans. No network call. This is the preferred source.
2. **Unofficial oauth usage endpoint** - used only if the snapshot is missing or
   older than ~3 minutes. Reads the OAuth token from `~/.claude/.credentials.json`.
3. **Context-window estimate** - if both of the above fail, the skill works only
   from the `/context` fill level and tells you the usage numbers are
   unavailable.

The skill is honest by design: it never displays a percentage it did not read
from a real source.

## Requirements

- A **Claude Pro or Max subscription**, so Claude Code streams `rate_limits`
  into the status line data (the snapshot source depends on this).
- **`jq`** - required by the bash helper (`scripts/usage-check`) on
  WSL/Linux/macOS.
  - On Windows you do **not** need `jq`: `scripts/usage-check.ps1` uses
    PowerShell's built-in `ConvertFrom-Json` / `Invoke-RestMethod` instead.
- **Node.js** - the status line wrapper (`scripts/statusline-snapshot.mjs`) runs
  under Node. Claude Code environments normally already have it.

## Manual installation

1. Clone the repository:

   ```bash
   git clone https://github.com/YossiYad/usage-guard
   ```

2. Copy the whole folder into your Claude skills directory as `usage-guard`:

   - **Windows (PowerShell):**

     ```powershell
     Copy-Item -Recurse -Force .\usage-guard "$env:USERPROFILE\.claude\skills\usage-guard"
     ```

     Target path: `C:\Users\<you>\.claude\skills\usage-guard`

   - **WSL / Linux / macOS:**

     ```bash
     mkdir -p ~/.claude/skills
     cp -r ./usage-guard ~/.claude/skills/usage-guard
     chmod +x ~/.claude/skills/usage-guard/scripts/usage-check
     ```

     Target path: `~/.claude/skills/usage-guard`

3. **Connect / merge the status line** in `~/.claude/settings.json` so the
   snapshot gets written. The wrapper is designed to **merge, not overwrite** -
   if you already have a status line, it keeps running it and stacks its output
   as before.

   - If you do **not** already have a `statusLine`, add one that points at the
     wrapper:

     ```json
     {
       "statusLine": {
         "type": "command",
         "command": "node \"C:\\Users\\<you>\\.claude\\skills\\usage-guard\\scripts\\statusline-snapshot.mjs\""
       }
     }
     ```

     (On WSL/Linux/macOS use
     `node "$HOME/.claude/skills/usage-guard/scripts/statusline-snapshot.mjs"`.)

   - If you **already have** a `statusLine`, keep your existing command but move
     it aside so the wrapper can chain to it:

     1. Copy your current `statusLine` block into a new file
        `~/.claude/usage-guard-prev-statusline.json`, for example:

        ```json
        { "statusLine": { "type": "command", "command": "<your existing command>" } }
        ```

     2. Change the `command` in `settings.json` to point at the wrapper (as
        shown above), keeping your original `type`/`padding`.

     The wrapper writes the snapshot, then runs your previous command with the
     same stdin and prints its output underneath - so your normal status line
     still shows exactly as before.

4. **Restart Claude Code** so the new status line starts running and begins
   writing `~/.claude/usage-snapshot.json` on each render.

## Quick installation through Claude Code

You can let Claude Code do all of the above for you. Paste this into Claude Code:

```text
Clone https://github.com/YossiYad/usage-guard and install the skill into my Claude skills directory at ~/.claude/skills/usage-guard. Merge the status line into settings.json without overwriting anything that already exists, and verify that the usage-check script runs and returns real numbers.
```

## Verifying it works

Run the helper directly:

- **Windows (PowerShell):**

  ```powershell
  powershell -NoProfile -File "$env:USERPROFILE\.claude\skills\usage-guard\scripts\usage-check.ps1"
  ```

- **WSL / Linux / macOS:**

  ```bash
  ~/.claude/skills/usage-guard/scripts/usage-check
  ```

You should see `key=value` lines with a `source` of `snapshot`, `api`, or
`unavailable`. A `source=api` or `source=snapshot` result with real
percentages means it is working.

## Troubleshooting

- **The snapshot is empty / missing (`source` is never `snapshot`).**
  The status line only writes the snapshot while Claude Code is running and
  rendering it. Make sure you completed the status line merge in step 3 and
  **restarted Claude Code**, then send any message so the status line renders at
  least once. The snapshot also depends on a Pro/Max plan (free plans do not
  stream `rate_limits`). Until a snapshot exists, the helper falls back to the
  API automatically.

- **The token is expired (`source=unavailable`, note mentions HTTP 401).**
  Re-authenticate Claude Code (sign out and back in) so `~/.claude/.credentials.json`
  gets a fresh `claudeAiOauth.accessToken`. The endpoint is unofficial, so this
  path can also break if the endpoint itself changes.

- **Usage data is unavailable (`source=unavailable`).**
  This is expected and safe: the skill will tell you the 5-hour and weekly
  numbers are unavailable and manage the session from the `/context` fill level
  alone. Check the `note=` field for the exact reason (no credentials, network
  error, jq missing on the bash path, etc.).

## Files

```text
usage-guard/
├── SKILL.md                       # skill instructions + thresholds
├── README.md
├── assets/
│   └── banner.jpg
└── scripts/
    ├── usage-check.ps1            # main helper (Windows / PowerShell)
    ├── usage-check                # main helper (WSL / Linux / macOS, needs jq)
    └── statusline-snapshot.mjs    # status line wrapper: writes the snapshot, chains your existing status line
```
