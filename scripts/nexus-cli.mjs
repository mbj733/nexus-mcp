#!/usr/bin/env node
/**
 * nexus-cli — standalone Nexus Mods automation (no Claude Code needed)
 *
 * Usage:
 *   node nexus-cli.mjs login              # log in via Chrome, save cookies
 *   node nexus-cli.mjs status             # check if logged in
 *   node nexus-cli.mjs games [query]      # search games
 *   node nexus-cli.mjs search <game> <query>  # search mods
 *   node nexus-cli.mjs download <game> <modId> [fileId] [--dir <path>]
 *   node nexus-cli.mjs url <game> <modId> [fileId]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const COOKIES_FILE = join(homedir(), ".nexus-mcp-cookies.json");
const GQL = "https://api.nexusmods.com/v2/graphql";
const NEXUS_WEB = "https://www.nexusmods.com";
const UA = "nexus-cli/1.0";

function loadCookies() {
  if (!existsSync(COOKIES_FILE)) return null;
  try { return JSON.parse(readFileSync(COOKIES_FILE, "utf-8")); }
  catch { return null; }
}

function saveCookies(cookies) {
  writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2), "utf-8");
}

function cookieString(cookies) {
  if (!cookies) return undefined;
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function login() {
  const CHROME_CANDIDATES = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
  ];

  const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chromePath) { console.error("Chrome not found"); process.exit(1); }

  const profileDir = join(tmpdir(), "nexus-cli-chrome");
  mkdirSync(profileDir, { recursive: true });

  console.log("Launching Chrome...");
  const proc = spawn(chromePath, [
    "--remote-debugging-port=9222",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    NEXUS_WEB,
  ], { stdio: "ignore", detached: true });
  proc.unref();

  await sleep(3000);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("\nLog in at nexusmods.com, then press Enter...");
  await new Promise((r) => rl.question("", r));
  rl.close();

  try {
    const cookies = await extractCookies();
    if (!cookies?.length) throw new Error("No cookies found");
    const names = new Set(cookies.map((c) => c.name));
    if (!names.has("nexusmods_session") && !names.has("nexusmods_session_refresh")) {
      throw new Error("Session cookie not found — did you log in?");
    }
    saveCookies(cookies);
    console.log(`\nSaved ${cookies.length} cookies to ${COOKIES_FILE}`);
    return cookies;
  } catch (e) {
    console.error("\n", e.message);
    process.exit(1);
  } finally {
    try { process.kill(-proc.pid); } catch {}
  }
}

async function extractCookies() {
  const targets = await (await fetch("http://localhost:9222/json")).json();
  const page = targets.find((t) => t.type === "page" && t.url.includes("nexusmods"));
  if (!page) throw new Error("No nexusmods tab found");

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Network.getAllCookies" }));
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id === 1) {
        ws.close();
        resolve((msg.result?.cookies || []).filter((c) => c.domain.includes("nexusmods")));
      }
    };
    ws.onerror = () => reject(new Error("WebSocket error"));
    setTimeout(() => reject(new Error("Timeout")), 10000);
  });
}

async function gql(query, vars = {}) {
  const res = await fetch(GQL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ query, variables: vars }),
  });
  const body = await res.json();
  if (body.errors?.length && !body.data) throw new Error(body.errors[0].message);
  return body.data;
}

async function checkSession(cookies) {
  try {
    const r = await fetch(`${NEXUS_WEB}/Core/Libs/Common/Widgets/DownloadPopUp?id=1&game_id=1`, {
      headers: { Cookie: cookieString(cookies), "User-Agent": UA },
    });
    const text = await r.text();
    return text.includes("dl_link") || text.includes("DownloadPopUp");
  } catch { return false; }
}

async function ensureCookies() {
  let cookies = loadCookies();
  if (cookies) {
    const valid = await checkSession(cookies);
    if (valid) return cookies;
    console.log("Session expired, re-login required.");
  }
  console.log("No valid session found. Launching login...");
  return await login();
}

async function getCdnUrl(cookies, gameDomain, modId, fileId) {
  const gameId = await resolveGameId(gameDomain);
  const res = await fetch(
    `${NEXUS_WEB}/Core/Libs/Common/Widgets/DownloadPopUp?id=${fileId}&game_id=${gameId}`,
    {
      headers: {
        Cookie: cookieString(cookies),
        Referer: `${NEXUS_WEB}/${gameDomain}/mods/${modId}?tab=files`,
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": UA,
      },
    },
  );
  const html = await res.text();
  const m = html.match(/id=["']dl_link["'][^>]*value=["']([^"']+)["']/i)
       || html.match(/value=["']([^"']+)["'][^>]*id=["']dl_link["']/i);
  if (m?.[1]?.startsWith("http")) return m[1];
  const fb = html.match(/https:\/\/files\.nexus-cdn\.com\/[^\s"'<>]+/i);
  if (fb) return fb[0];
  throw new Error("Could not extract CDN URL");
}

async function resolveGameId(domain) {
  const data = await gql(
    `query ($d: String!) { game(domainName: $d) { id } }`,
    { d: domain },
  );
  if (!data.game) throw new Error(`Unknown game: ${domain}`);
  return data.game.id;
}

async function downloadFile(url, destDir, fileName) {
  const { createWriteStream } = await import("node:fs");
  const path = await import("node:path");

  mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, fileName);

  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`CDN HTTP ${res.status}`);

  const total = Number(res.headers.get("content-length") || 0);
  const file = createWriteStream(dest);
  const reader = res.body.getReader();
  let done = 0, lastLog = 0;

  while (true) {
    const { done: isDone, value } = await reader.read();
    if (isDone) break;
    file.write(Buffer.from(value));
    done += value.length;
    if (Date.now() - lastLog > 2000) {
      lastLog = Date.now();
      const pct = total > 0 ? Math.round((done / total) * 100) : -1;
      process.stderr.write(`\r  ${pct > 0 ? pct + "%" : ""} ${(done/1048576).toFixed(1)}/${(total/1048576).toFixed(1)} MB`);
    }
  }
  file.end();
  await new Promise((resolve, reject) => { file.on("finish", resolve); file.on("error", reject); });
  process.stderr.write("\n");
  return dest;
}

const cmd = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  switch (cmd) {
    case "login": {
      await login();
      break;
    }

    case "status": {
      const cookies = loadCookies();
      if (!cookies) { console.log("Not logged in. Run: node nexus-cli.mjs login"); break; }
      const valid = await checkSession(cookies);
      console.log(valid ? "Session valid" : "Session expired. Run: node nexus-cli.mjs login");
      break;
    }

    case "games": {
      const query = args[0] || "";
      const filter = query ? { name: [{ value: query, op: "WILDCARD" }] } : undefined;
      const data = await gql(
        `query ($f: GamesSearchFilter, $n: Int) {
          games(filter: $f, sort: [{ mods: { direction: DESC } }], count: $n) {
            nodes { id name domainName modCount }
          }
        }`,
        { f: filter, n: 20 },
      );
      for (const g of data.games.nodes) {
        console.log(`${g.domainName}  (${g.name})  mods: ${g.modCount}`);
      }
      break;
    }

    case "search": {
      const [game, ...queryParts] = args;
      const query = queryParts.join(" ");
      if (!game || !query) { console.error("Usage: nexus-cli search <game> <query>"); process.exit(1); }
      const data = await gql(
        `query ($f: ModsFilter!, $c: Int) {
          mods(filter: $f, sort: [{ endorsements: { direction: DESC } }], count: $c) {
            totalCount nodes { modId name version summary downloads endorsements }
          }
        }`,
        { f: { name: [{ value: `*${query}*`, op: "WILDCARD" }], gameDomainName: [{ value: game, op: "EQUALS" }] }, c: 20 },
      );
      console.log(`Found ${data.mods.totalCount} mods:\n`);
      for (const m of data.mods.nodes) {
        console.log(`  [${m.modId}] ${m.name}  v${m.version}  E${m.endorsements}  DL${m.downloads}`);
        console.log(`       ${(m.summary || "").slice(0, 100)}`);
      }
      break;
    }

    case "url": {
      const [game, modIdStr, fileIdStr] = args;
      if (!game || !modIdStr) { console.error("Usage: nexus-cli url <game> <modId> [fileId]"); process.exit(1); }
      const cookies = await ensureCookies();
      const modId = Number(modIdStr);
      let fileId = fileIdStr ? Number(fileIdStr) : undefined;
      if (!fileId) {
        const gameId = await resolveGameId(game);
        const data = await gql(
          `query ($m: ID!, $g: ID!) { modFiles(modId: $m, gameId: $g) { fileId primary } }`,
          { m: String(modId), g: String(gameId) },
        );
        const primary = data.modFiles.find((f) => f.primary === 1);
        if (!primary) { console.error("No primary file found. Specify fileId."); process.exit(1); }
        fileId = primary.fileId;
      }
      const cdnUrl = await getCdnUrl(cookies, game, modId, fileId);
      console.log(cdnUrl);
      break;
    }

    case "download": {
      let game, modIdStr, fileIdStr, dir = process.cwd();
      const rest = [...args];
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--dir" || rest[i] === "-d") { dir = rest[++i]; continue; }
        if (!game) { game = rest[i]; continue; }
        if (!modIdStr) { modIdStr = rest[i]; continue; }
        if (!fileIdStr) { fileIdStr = rest[i]; continue; }
      }
      if (!game || !modIdStr) { console.error("Usage: nexus-cli download <game> <modId> [fileId] [--dir <path>]"); process.exit(1); }

      console.log("Checking session...");
      const cookies = await ensureCookies();
      const modId = Number(modIdStr);
      let fileId = fileIdStr ? Number(fileIdStr) : undefined;

      if (!fileId) {
        const gameId = await resolveGameId(game);
        const data = await gql(
          `query ($m: ID!, $g: ID!) { modFiles(modId: $m, gameId: $g) { fileId primary name } }`,
          { m: String(modId), g: String(gameId) },
        );
        const primary = data.modFiles.find((f) => f.primary === 1);
        if (!primary) { console.error("No primary file. Specify fileId."); process.exit(1); }
        fileId = primary.fileId;
        console.log(`Primary file: ${primary.name} (id=${fileId})`);
      }

      console.log("Getting CDN URL...");
      const cdnUrl = await getCdnUrl(cookies, game, modId, fileId);

      const fileName = decodeURIComponent(new URL(cdnUrl).pathname.split("/").pop());
      console.log(`Downloading ${fileName}...`);
      const dest = await downloadFile(cdnUrl, dir, fileName);
      console.log(`\nSaved to ${dest}`);
      break;
    }

    default:
      console.log(`nexus-cli — standalone Nexus Mods automation

Usage:
  node nexus-cli.mjs login                      Log in via Chrome (saves cookies)
  node nexus-cli.mjs status                     Check login status
  node nexus-cli.mjs games [query]              Search games
  node nexus-cli.mjs search <game> <query>      Search mods
  node nexus-cli.mjs url <game> <modId> [file]  Get CDN download URL
  node nexus-cli.mjs download <game> <modId> [file] [--dir <path>]
                                                 Download mod to disk

Examples:
  node nexus-cli.mjs games skyrim
  node nexus-cli.mjs search skyrimspecialedition "unofficial patch"
  node nexus-cli.mjs download skyrimspecialedition 266
  node nexus-cli.mjs download baldursgate3 1234 --dir ./mods`);
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((e) => { console.error("Error:", e.message); process.exit(1); });
