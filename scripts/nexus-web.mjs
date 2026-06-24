#!/usr/bin/env node
/**
 * nexus-web — local HTTP server with web UI for Nexus Mods search & download.
 *
 * Start:  node nexus-web.mjs [--port 3456]
 * Open:   http://localhost:3456 in any browser (Edge, Chrome, etc.)
 */

import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync, createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const PORT = parseInt(process.argv[process.argv.indexOf("--port") + 1] || "3456");
const COOKIES_FILE = join(homedir(), ".nexus-mcp-cookies.json");
const GQL = "https://api.nexusmods.com/v2/graphql";
const NEXUS_WEB = "https://www.nexusmods.com";
const UA = "nexus-web/1.0";

function loadCookies() {
  if (!existsSync(COOKIES_FILE)) return null;
  try { return JSON.parse(readFileSync(COOKIES_FILE, "utf-8")); }
  catch { return null; }
}
function saveCookies(c) { writeFileSync(COOKIES_FILE, JSON.stringify(c, null, 2), "utf-8"); }
function cookieStr(c) { return c?.map(x => `${x.name}=${x.value}`).join("; "); }

const HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nexus Web</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font:14px/1.5 system-ui,sans-serif;background:#1a1a2e;color:#eee;min-height:100vh}
header{background:#16213e;padding:12px 20px;display:flex;align-items:center;gap:12px}
header h1{font-size:18px}
.status{font-size:12px;padding:3px 8px;border-radius:4px}
.status.on{background:#0a4}
.status.off{background:#a40}
main{padding:20px;max-width:1000px;margin:0 auto}
.row{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}
input,select,button{padding:8px 12px;border:1px solid #333;border-radius:6px;background:#0f3460;color:#eee;font-size:14px}
button{cursor:pointer;background:#e94560;border-color:#e94560;font-weight:bold}
button:hover{opacity:.85}
button:disabled{opacity:.4;cursor:default}
.game-tag{cursor:pointer;padding:4px 10px;border-radius:4px;background:#0f3460;font-size:13px}
.game-tag:hover{background:#e94560}
.mod-card{background:#16213e;border-radius:8px;padding:12px;margin-bottom:8px;display:flex;gap:12px;align-items:flex-start}
.mod-info{flex:1}
.mod-name{font-weight:bold;font-size:15px;color:#e94560}
.mod-summary{font-size:13px;color:#aaa;margin:4px 0}
.mod-stats{font-size:12px;color:#888}
.mod-actions{display:flex;flex-direction:column;gap:4px}
.mod-actions button{padding:4px 10px;font-size:12px}
#log{background:#111;border-radius:8px;padding:12px;margin-top:12px;max-height:300px;overflow-y:auto;font:12px monospace;color:#0f0;white-space:pre-wrap}
#log .err{color:#f44}
#log .info{color:#88f}
</style></head>
<body>
<header>
  <h1>Nexus Web</h1>
  <span id="status" class="status off">offline</span>
  <span style="flex:1"></span>
  <button onclick="login()">Login</button>
</header>
<main>
  <div class="row">
    <input id="gameSearch" placeholder="Search games..." onkeyup="if(event.key==='Enter')searchGames()">
    <button onclick="searchGames()">Games</button>
  </div>
  <div id="games" class="row"></div>
  <div class="row">
    <input id="gameDomain" placeholder="Game domain (e.g. baldursgate3)" style="width:200px">
    <input id="modQuery" placeholder="Mod search..." onkeyup="if(event.key==='Enter')searchMods()">
    <button onclick="searchMods()">Mods</button>
  </div>
  <div id="results"></div>
  <div id="log"></div>
</main>
</body></html>`;

async function gql(query, vars = {}) {
  const r = await fetch(GQL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Application-Name": "nexus-web", "Accept": "application/json", "User-Agent": UA },
    body: JSON.stringify({ query, variables: vars }),
  });
  return r.json();
}

async function resolveGameId(domain) {
  const d = await gql(`query ($d: String!) { game(domainName: $d) { id } }`, { d: domain });
  if (!d.data?.game) throw new Error(`Unknown game: ${domain}`);
  return d.data.game.id;
}

async function getCdnUrl(cookies, game, modId, fileId) {
  const gid = await resolveGameId(game);
  const r = await fetch(`${NEXUS_WEB}/Core/Libs/Common/Widgets/DownloadPopUp?id=${fileId}&game_id=${gid}`, {
    headers: { Cookie: cookieStr(cookies), Referer: `${NEXUS_WEB}/${game}/mods/${modId}?tab=files`, "X-Requested-With": "XMLHttpRequest", "User-Agent": UA },
  });
  const html = await r.text();
  const m = html.match(/id=["']dl_link["'][^>]*value=["']([^"']+)["']/i)
         || html.match(/value=["']([^"']+)["'][^>]*id=["']dl_link["']/i);
  if (m?.[1]?.startsWith("http")) return m[1];
  const fb = html.match(/https:\/\/files\.nexus-cdn\.com\/[^\s"'<>]+/i);
  if (fb) return fb[0];
  throw new Error("Could not extract CDN URL");
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  const q = Object.fromEntries(url.searchParams);

  try {
    if (p === "/" || p === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(HTML);
    }

    if (p === "/status") {
      const c = loadCookies();
      return json(res, { loggedIn: !!c, cookies: c?.length || 0 });
    }

    if (p === "/games") {
      const filter = q.q ? { name: [{ value: q.q, op: "WILDCARD" }] } : undefined;
      const d = await gql(
        `query ($f: GamesSearchFilter, $n: Int) { games(filter: $f, sort: [{mods:{direction:DESC}}], count:$n) { nodes { id name domainName modCount } } }`,
        { f: filter, n: 20 },
      );
      return json(res, { games: d.data?.games?.nodes?.map(g => ({ id: g.id, name: g.name, domain: g.domainName, mods: g.modCount })) });
    }

    if (p === "/search") {
      if (!q.game || !q.q) return json(res, { error: "game and q required" }, 400);
      const d = await gql(
        `query ($f: ModsFilter!, $c: Int) { mods(filter:$f, sort:[{endorsements:{direction:DESC}}], count:$c) { totalCount nodes { modId name version summary downloads endorsements } } }`,
        { f: { nameStemmed: [{ value: q.q, op: "MATCHES" }], gameDomainName: [{ value: q.game, op: "EQUALS" }] }, c: 20 },
      );
      return json(res, { mods: d.data?.mods?.nodes });
    }

    if (p === "/url") {
      const c = loadCookies();
      if (!c) return json(res, { error: "Not logged in" }, 401);
      const gid = await resolveGameId(q.game);
      const d = await gql(
        `query ($m:ID!,$g:ID!){modFiles(modId:$m,gameId:$g){fileId primary}}`,
        { m: q.modId, g: String(gid) },
      );
      const primary = d.data?.modFiles?.find(f => f.primary === 1);
      const fid = primary?.fileId;
      if (!fid) return json(res, { error: "No primary file" }, 404);
      const cdn = await getCdnUrl(c, q.game, Number(q.modId), fid);
      return json(res, { url: cdn });
    }

    if (p === "/download") {
      const c = loadCookies();
      if (!c) return json(res, { error: "Not logged in" }, 401);
      const gid = await resolveGameId(q.game);
      const d = await gql(
        `query ($m:ID!,$g:ID!){modFiles(modId:$m,gameId:$g){fileId primary name}}`,
        { m: q.modId, g: String(gid) },
      );
      const primary = d.data?.modFiles?.find(f => f.primary === 1);
      if (!primary) return json(res, { error: "No primary file" }, 404);

      const cdn = await getCdnUrl(c, q.game, Number(q.modId), primary.fileId);
      const dir = q.dir || join(homedir(), "Downloads", "nexus-mods");
      mkdirSync(dir, { recursive: true });

      const fn = decodeURIComponent(new URL(cdn).pathname.split("/").pop());
      const dest = join(dir, fn);

      const cres = await fetch(cdn, { headers: { "User-Agent": UA } });
      if (!cres.ok) throw new Error(`CDN HTTP ${cres.status}`);

      const ws = createWriteStream(dest);
      const reader = cres.body.getReader();
      while (true) { const { done, value } = await reader.read(); if (done) break; ws.write(Buffer.from(value)); }
      ws.end();
      await new Promise((resolve, reject) => { ws.on("finish", resolve); ws.on("error", reject); });

      return json(res, { ok: true, path: dest, file: fn });
    }

    if (p === "/login") {
      const candidates = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/google-chrome",
      ];
      const chrome = candidates.find(p => existsSync(p));
      if (!chrome) return json(res, { ok: false, error: "Chrome not found" });

      const profile = join(tmpdir(), "nexus-web-chrome");
      mkdirSync(profile, { recursive: true });

      spawn(chrome, [
        "--remote-debugging-port=9223",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        NEXUS_WEB,
      ], { stdio: "ignore", detached: true });

      await new Promise(r => setTimeout(r, 4000));

      const targets = await (await fetch("http://localhost:9223/json")).json();
      const page = targets.find(t => t.type === "page" && t.url.includes("nexusmods"));
      if (!page) return json(res, { ok: false, error: "No nexusmods tab" });

      const cookies = await new Promise((resolve, reject) => {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Network.getAllCookies" }));
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.id === 1) {
            ws.close();
            resolve((msg.result?.cookies || []).filter(c => c.domain.includes("nexusmods")));
          }
        };
        ws.onerror = () => reject(new Error("WebSocket error"));
        setTimeout(() => reject(new Error("Timeout")), 10000);
      });

      if (!cookies.length) return json(res, { ok: false, error: "No cookies" });
      saveCookies(cookies);
      return json(res, { ok: true, cookies: cookies.length });
    }

    json(res, { error: "Not found" }, 404);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`\nNexus Web: http://localhost:${PORT}\n`);
});
