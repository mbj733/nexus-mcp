/**
 * Thin client for the Nexus Mods v2 GraphQL API, v1 REST API, and website scraping.
 *
 * GraphQL:   api.nexusmods.com/v2/graphql (discovery / metadata)
 * v1 REST:   api.nexusmods.com/v1         (metadata; download_link may need premium)
 * Web scrape: www.nexusmods.com           (DownloadPopUp widget → CDN URL; cookies auth)
 *
 * Auth: personal API key as `APIKEY` header for API calls;
 * browser cookies (NEXUS_COOKIES env var) for web scraping fallback.
 */
const GQL_ENDPOINT = "https://api.nexusmods.com/v2/graphql";
const V1_BASE = "https://api.nexusmods.com/v1";
const WEB_BASE = "https://www.nexusmods.com";
const USER_AGENT = "nexus-mcp/0.2.1 (local MCP server)";
const APP_NAME = "nexus-mcp";
const APP_VERSION = "0.2.1";
export class NexusError extends Error {
}
// ---- HTTP helpers ----------------------------------------------------------
function apiKey() {
    return process.env.NEXUS_MODS_API_KEY?.trim() || undefined;
}
function apiHeaders() {
    const key = apiKey();
    if (!key)
        throw new NexusError("NEXUS_MODS_API_KEY is required for this operation");
    return {
        "APIKEY": key,
        "Application-Name": APP_NAME,
        "Application-Version": APP_VERSION,
        "Protocol-Version": "1.0.0",
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
    };
}
function apiHeadersOpt() {
    const h = {
        "Application-Name": APP_NAME,
        "Application-Version": APP_VERSION,
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
    };
    const key = apiKey();
    if (key)
        h["APIKEY"] = key;
    return h;
}
function cookiesHeader() {
    const raw = process.env.NEXUS_COOKIES?.trim();
    if (!raw)
        return undefined;
    try {
        const arr = JSON.parse(raw);
        return arr.map((c) => `${c.name}=${c.value}`).join("; ");
    }
    catch {
        // Maybe it's already a raw cookie string
        if (raw.includes("="))
            return raw;
        return undefined;
    }
}
// ---- v2 GraphQL ------------------------------------------------------------
export async function gql(query, variables = {}) {
    const headers = {
        "Content-Type": "application/json",
        ...apiHeadersOpt(),
    };
    const res = await fetch(GQL_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
        throw new NexusError(`Nexus API HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    const body = (await res.json());
    if (body.errors?.length) {
        const msgs = body.errors
            .map((e) => (e.path ? `${e.path.join(".")}: ${e.message}` : e.message))
            .join("; ");
        if (body.data == null)
            throw new NexusError(`Nexus API error: ${msgs}`);
        console.error(`nexus-mcp: partial GraphQL errors: ${msgs}`);
    }
    if (body.data == null)
        throw new NexusError("Nexus API returned no data");
    return body.data;
}
/**
 * Try to get a CDN download URL. Strategy:
 * 1. If API key is set, try v1 REST download_link.json with proper headers.
 * 2. If that fails or no API key, fall back to scraping the website's
 *    DownloadPopUp widget (requires NEXUS_COOKIES env var with browser cookies).
 */
export async function getDownloadLink(gameDomain, modId, fileId, gameId) {
    // Strategy 1: v1 REST API (requires API key)
    if (apiKey()) {
        try {
            return await getDownloadLinkV1(gameDomain, modId, fileId);
        }
        catch (e) {
            console.error(`nexus-mcp: v1 download_link failed, falling back to web scrape: ${e}`);
        }
    }
    // Strategy 2: Web scrape DownloadPopUp (requires cookies)
    return await getDownloadLinkWeb(gameDomain, modId, fileId, gameId);
}
/** v1 REST API download_link.json */
async function getDownloadLinkV1(gameDomain, modId, fileId) {
    const url = `${V1_BASE}/games/${encodeURIComponent(gameDomain)}/mods/${modId}/files/${fileId}/download_link.json`;
    const res = await fetch(url, { headers: apiHeaders() });
    if (!res.ok) {
        const text = await res.text();
        throw new NexusError(`v1 API HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const body = await res.json();
    const item = Array.isArray(body) ? body[0] : body;
    if (!item?.URI && !item?.uri) {
        throw new NexusError(`Unexpected response: ${JSON.stringify(body).slice(0, 300)}`);
    }
    const cdnUrl = item.URI || item.uri;
    const urlPath = new URL(cdnUrl).pathname;
    const fileName = decodeURIComponent(urlPath.split("/").pop() ?? "download");
    return { url: cdnUrl, fileName, size: item.size || item.fileSize || 0 };
}
/** Web scrape: DownloadPopUp widget → extract CDN URL from HTML */
async function getDownloadLinkWeb(gameDomain, modId, fileId, gameId) {
    const cookie = cookiesHeader();
    if (!cookie) {
        throw new NexusError("No API key and no NEXUS_COOKIES set. " +
            "Set NEXUS_MODS_API_KEY (personal API key) or NEXUS_COOKIES (browser cookies JSON). " +
            "See https://github.com/mbj733/nexus-mcp#authentication");
    }
    const dlUrl = `${WEB_BASE}/Core/Libs/Common/Widgets/DownloadPopUp`;
    const res = await fetch(`${dlUrl}?id=${fileId}&game_id=${gameId}`, {
        headers: {
            "Cookie": cookie,
            "Referer": `${WEB_BASE}/${gameDomain}/mods/${modId}?tab=files`,
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent": USER_AGENT,
        },
    });
    if (!res.ok) {
        throw new NexusError(`DownloadPopUp HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    const html = await res.text();
    // Extract CDN URL: look for #dl_link input value
    const dlLinkMatch = html.match(/id=["']dl_link["'][^>]*value=["']([^"']+)["']/i)
        || html.match(/value=["']([^"']+)["'][^>]*id=["']dl_link["']/i);
    if (dlLinkMatch?.[1]?.startsWith("http")) {
        const cdnUrl = dlLinkMatch[1];
        const urlPath = new URL(cdnUrl).pathname;
        const fileName = decodeURIComponent(urlPath.split("/").pop() ?? "download");
        return { url: cdnUrl, fileName, size: 0 };
    }
    // Fallback: scan for files.nexus-cdn.com URLs
    const fallback = html.match(/https:\/\/files\.nexus-cdn\.com\/[^\s"'<>]+/i);
    if (fallback) {
        const cdnUrl = fallback[0];
        const urlPath = new URL(cdnUrl).pathname;
        const fileName = decodeURIComponent(urlPath.split("/").pop() ?? "download");
        return { url: cdnUrl, fileName, size: 0 };
    }
    throw new NexusError(`Could not extract CDN URL from DownloadPopUp (${html.length} bytes). ` +
        "Your session cookies may have expired. Re-export fresh cookies.");
}
/**
 * Download a file from a CDN URL to a local path. Streams the response.
 * Returns the absolute path of the saved file.
 */
export async function downloadToFile(cdnUrl, destDir, fileName, onProgress) {
    const { createWriteStream, mkdirSync, existsSync } = await import("node:fs");
    const path = await import("node:path");
    if (!existsSync(destDir))
        mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, fileName);
    const res = await fetch(cdnUrl, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
        throw new NexusError(`CDN download HTTP ${res.status}: ${await res.text().catch(() => "unknown")}`);
    }
    if (!res.body) {
        throw new NexusError("CDN response has no body");
    }
    const contentLength = Number(res.headers.get("content-length") || 0);
    const fileStream = createWriteStream(destPath);
    const reader = res.body.getReader();
    let downloaded = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            fileStream.write(Buffer.from(value));
            downloaded += value.length;
            onProgress?.(downloaded, contentLength);
        }
    }
    finally {
        fileStream.end();
        reader.releaseLock();
    }
    // Wait for the write stream to finish
    await new Promise((resolve, reject) => {
        fileStream.on("finish", resolve);
        fileStream.on("error", reject);
    });
    return destPath;
}
// ---- helpers ---------------------------------------------------------------
const gameIdCache = new Map();
export async function resolveGameId(domainName) {
    const cached = gameIdCache.get(domainName);
    if (cached !== undefined)
        return cached;
    const data = await gql(`query ($domainName: String!) { game(domainName: $domainName) { id } }`, { domainName });
    if (!data.game)
        throw new NexusError(`Unknown game domain: "${domainName}"`);
    gameIdCache.set(domainName, data.game.id);
    return data.game.id;
}
/** Unix seconds → ISO date string (Nexus ModFile.date is an Int). */
export function isoDate(unixSeconds) {
    return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}
