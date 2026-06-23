import { writeFileSync, readFileSync, writeSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const CLAUDE_DIR = join(HOME, ".claude");
const SNAPSHOT_PATH = join(CLAUDE_DIR, "usage-snapshot.json");
const CHAIN_PATH = join(CLAUDE_DIR, "usage-guard-prev-statusline.json");
const HARD_DEADLINE_MS = 6000;
const CHAIN_TIMEOUT_MS = 5000;
const DRAIN_MS = 150;

let wrote = false;
const put = (s) => {
  try { writeSync(1, s); wrote = true; } catch { /* never throw from a status line */ }
};

const toNumber = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

const toPercent = (obj) => {
  if (!obj || typeof obj !== "object") return null;
  for (const key of ["utilization", "percent", "percentage", "pct", "used_pct"]) {
    const v = toNumber(obj[key]);
    if (v !== null) return Math.round(v <= 1 ? v * 100 : v);
  }
  const used = toNumber(obj.used_tokens ?? obj.used ?? obj.tokens_used ?? obj.input_tokens);
  const total = toNumber(
    obj.total_tokens ?? obj.max_tokens ?? obj.limit ?? obj.total ?? obj.size ?? obj.context_size,
  );
  if (used !== null && total !== null && total > 0) return Math.round((used / total) * 100);
  return null;
};

const resetsAt = (obj) => {
  if (!obj || typeof obj !== "object") return null;
  const v = obj.resets_at ?? obj.reset_at ?? obj.resetsAt;
  return typeof v === "string" ? v : null;
};

const writeSnapshot = (raw) => {
  let parsed = null;
  try { parsed = JSON.parse(String(raw).replace(/^﻿/, "").trim()); } catch { parsed = null; }

  const fiveHour = parsed?.rate_limits?.five_hour ?? null;
  const sevenDay = parsed?.rate_limits?.seven_day ?? null;
  const contextWindow = parsed?.context_window ?? null;

  const snapshot = {
    timestamp: new Date().toISOString(),
    source: "statusline",
    five_hour: fiveHour,
    seven_day: sevenDay,
    context_window: contextWindow,
    five_hour_pct: toPercent(fiveHour),
    seven_day_pct: toPercent(sevenDay),
    context_pct: toPercent(contextWindow),
    five_hour_resets_at: resetsAt(fiveHour),
    seven_day_resets_at: resetsAt(sevenDay),
  };

  try { writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2)); } catch { /* never throw */ }
};

const runChain = (raw) => {
  let cmd = "";
  try {
    const chain = JSON.parse(readFileSync(CHAIN_PATH, "utf8").replace(/^﻿/, "").trim());
    const sl = chain?.statusLine ?? chain;
    if (sl && sl.type === "command" && typeof sl.command === "string") cmd = sl.command;
    else if (typeof chain?.command === "string") cmd = chain.command;
  } catch { cmd = ""; }

  if (!cmd || cmd.includes("statusline-snapshot.mjs")) {
    process.exit(0);
    return;
  }

  const child = spawn(cmd, { shell: true, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
  let out = "";
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    const text = out.replace(/[\r\n]+$/, "");
    if (text) put((wrote ? "\n" : "") + text);
    process.exit(0);
  };
  try { child.stdin.write(raw); child.stdin.end(); } catch { /* ignore */ }
  child.stdout.on("data", (d) => { out += d; });
  child.stdout.on("error", () => { /* degrade to whatever drained */ });
  child.on("error", finish);
  child.on("close", finish);
  child.on("exit", () => { setTimeout(finish, DRAIN_MS); });
  setTimeout(() => { try { child.kill(); } catch { /* best-effort */ } finish(); }, CHAIN_TIMEOUT_MS);
};

const proceed = (raw) => {
  writeSnapshot(raw);
  runChain(raw);
};

try {
  if (process.stdin.isTTY) {
    proceed("");
  } else {
    const chunks = [];
    let settled = false;
    const go = () => { if (settled) return; settled = true; proceed(chunks.join("")); };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", go);
    process.stdin.on("error", go);
    setTimeout(go, HARD_DEADLINE_MS);
  }
} catch {
  process.exit(0);
}
