import { spawn, spawnSync } from "node:child_process";
import os from "node:os";

// Headless Claude Code CLI on the user's subscription login (autojob's proven
// pattern) — no API key, usage draws from the subscription's rolling limits.
// `--json-schema` enforces the response shape server-side, so `result` comes
// back as JSON that already conforms.

const TIMEOUT_MS = 120_000; // CLI spawn + agent startup + thinking adds seconds
const MODEL = process.env.CLAUDE_MODEL || "sonnet";

let cliAvailable: boolean | null = null;

// One `claude --version` probe per process; the binary doesn't come and go.
export function hasClaudeCli(): boolean {
  if (cliAvailable === null) {
    try {
      cliAvailable = spawnSync("claude", ["--version"], { timeout: 10_000 }).status === 0;
    } catch {
      cliAvailable = false;
    }
  }
  return cliAvailable;
}

/** Runs one prompt through `claude -p` and returns the model's result text. */
export function runClaude(prompt: string, schema: object): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--output-format",
      "json",
      "--model",
      MODEL,
      "--json-schema",
      JSON.stringify(schema),
    ];
    // cwd is a neutral temp dir so the run doesn't load this repo's agent
    // context (CLAUDE.md, .claude/) into every triage call.
    const child = spawn("claude", args, { cwd: os.tmpdir() });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`claude timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.trim().slice(0, 300)}`));
        return;
      }
      // --output-format json wraps the reply in an envelope; the model's text
      // (our JSON payload) is the `result` field.
      try {
        const envelope = JSON.parse(stdout) as { result?: unknown; is_error?: boolean };
        if (envelope.is_error || typeof envelope.result !== "string") {
          reject(new Error(`claude returned an error envelope: ${stdout.slice(0, 200)}`));
          return;
        }
        resolve(envelope.result);
      } catch {
        reject(new Error(`claude envelope was not JSON: ${stdout.slice(0, 200)}`));
      }
    });
    // Prompt goes over stdin — article bodies overflow argv limits.
    child.stdin.write(prompt);
    child.stdin.end();
  });
}
