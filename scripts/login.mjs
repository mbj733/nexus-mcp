#!/usr/bin/env node
/**
 * Extract Nexus Mods browser cookies via Chrome DevTools Protocol.
 *
 * Usage:
 *   node scripts/login.mjs
 *
 * What it does:
 *   1. Launches Chrome with remote debugging enabled
 *   2. Opens nexusmods.com — you log in manually in that window
 *   3. Press Enter here when done
 *   4. Extracts nexusmods cookies and prints the NEXUS_COOKIES value
 *
 * Then set the printed value as the NEXUS_COOKIES env var for nexus-mcp.
 */

import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

// ---- Find Chrome ----
const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error("Chrome not found. Install Chrome or set CHROME_PATH env var.");
  process.exit(1);
}

// ---- Launch Chrome with remote debugging ----
const profileDir = join(tmpdir(), "nexus-mcp-chrome-login");
mkdirSync(profileDir, { recursive: true });

console.log("Launching Chrome...");
const proc = spawn(chromePath, [
  "--remote-debugging-port=9222",
  `--user-data-dir=${profileDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "https://www.nexusmods.com",
], { stdio: "ignore", detached: true });
proc.unref();

// ---- Wait for Chrome to start ----
await new Promise((r) => setTimeout(r, 3000));

// ---- Prompt user to log in ----
const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log("\n🔑 A Chrome window should be open at nexusmods.com.");
console.log("   Log in with your Nexus Mods account, then press Enter here...");
await new Promise((resolve) => rl.question("", resolve));
rl.close();

// ---- Extract cookies via CDP ----
async function getCookies() {
  const targetsResp = await fetch("http://localhost:9222/json");
  const targets = await targetsResp.json();
  const page = targets.find((t) => t.type === "page" && t.url.includes("nexusmods"));
  if (!page) throw new Error("No nexusmods page found in Chrome tabs");

  const wsUrl = page.webSocketDebuggerUrl;
  const ws = new WebSocket(wsUrl);

  return new Promise((resolve, reject) => {
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: "Network.getAllCookies" }));
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data.toString());
      if (msg.id === 1) {
        const allCookies = msg.result?.cookies || [];
        const nexusCookies = allCookies.filter(
          (c) => c.domain.includes("nexusmods"),
        );
        ws.close();
        resolve(nexusCookies);
      }
    };
    ws.onerror = () => reject(new Error("WebSocket error"));
    setTimeout(() => reject(new Error("Timeout")), 10000);
  });
}

try {
  const cookies = await getCookies();
  if (cookies.length === 0) {
    console.error("\n❌ No Nexus Mods cookies found. Did you log in?");
    process.exit(1);
  }

  const names = cookies.map((c) => c.name);
  if (!names.includes("nexusmods_session") && !names.includes("nexusmods_session_refresh")) {
    console.error("\n❌ Login session not detected. Make sure you're logged in.");
    process.exit(1);
  }

  const compactJson = JSON.stringify(cookies.map(({ name, value, domain }) => ({ name, value, domain })));

  console.log("\n✅ Got", cookies.length, "cookies.\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Add this to your MCP config:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log(`NEXUS_COOKIES='${compactJson.replace(/'/g, "\\'")}'\n`);

  console.log("Or save to file for Claude Desktop config:");
  console.log(JSON.stringify(cookies, null, 2));

} catch (e) {
  console.error("\n❌", e.message);
} finally {
  try { process.kill(-proc.pid); } catch {}
  process.exit(0);
}
