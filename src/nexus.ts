/**
 * Thin client for the Nexus Mods v2 GraphQL API and v1 REST API.
 *
 * GraphQL endpoint: api.nexusmods.com/v2/graphql (discovery / metadata)
 * REST endpoint:   api.nexusmods.com/v1          (download links)
 *
 * Auth is an optional personal API key sent as the `apikey`
 * header — see docs/adr/0001-personal-api-key-auth.md.
 */

const GQL_ENDPOINT = "https://api.nexusmods.com/v2/graphql";
const V1_BASE = "https://api.nexusmods.com/v1";
const USER_AGENT = "nexus-mcp/0.2.0 (local MCP server)";

export class NexusError extends Error {}

// ---- HTTP helpers ----------------------------------------------------------

function authHeaders(): Record<string, string> {
  const apiKey = process.env.NEXUS_MODS_API_KEY?.trim();
  if (!apiKey) throw new NexusError("NEXUS_MODS_API_KEY is required for this operation");
  return { apikey: apiKey, "User-Agent": USER_AGENT };
}

function authHeadersOptional(): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": USER_AGENT };
  const apiKey = process.env.NEXUS_MODS_API_KEY?.trim();
  if (apiKey) h["apikey"] = apiKey;
  return h;
}

// ---- v2 GraphQL ------------------------------------------------------------

export async function gql<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeadersOptional(),
  };

  const res = await fetch(GQL_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new NexusError(`Nexus API HTTP ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as {
    data?: T;
    errors?: { message: string; path?: (string | number)[] }[];
  };
  if (body.errors?.length) {
    const msgs = body.errors
      .map((e) => (e.path ? `${e.path.join(".")}: ${e.message}` : e.message))
      .join("; ");
    if (body.data == null) throw new NexusError(`Nexus API error: ${msgs}`);
    console.error(`nexus-mcp: partial GraphQL errors: ${msgs}`);
  }
  if (body.data == null) throw new NexusError("Nexus API returned no data");
  return body.data;
}

// ---- v1 REST (download) ----------------------------------------------------

export interface DownloadLink {
  /** Pre-signed CDN download URL (temporary, expires) */
  url: string;
  /** Human-readable file name from Content-Disposition */
  fileName: string;
  /** File size in bytes (may be 0 if unknown) */
  size: number;
}

/**
 * Fetch a pre-signed CDN download link from the v1 REST API.
 * Requires NEXUS_MODS_API_KEY (personal API key).
 */
export async function getDownloadLink(
  gameDomain: string,
  modId: number,
  fileId: number,
): Promise<DownloadLink> {
  const url = `${V1_BASE}/games/${encodeURIComponent(gameDomain)}/mods/${modId}/files/${fileId}/download_link.json`;
  const res = await fetch(url, { headers: authHeaders() });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401) throw new NexusError("Authentication failed — check NEXUS_MODS_API_KEY");
    throw new NexusError(`Download link API HTTP ${res.status}: ${text}`);
  }

  // Response is either { uri, ... } or [{ uri, ... }]
  const body = await res.json();
  const item = Array.isArray(body) ? body[0] : body;
  if (!item?.URI && !item?.uri) {
    throw new NexusError(`Download link API returned unexpected response: ${JSON.stringify(body).slice(0, 300)}`);
  }

  const cdnUrl: string = item.URI || item.uri;
  // Extract filename from URL path
  const urlPath = new URL(cdnUrl).pathname;
  const fileName = decodeURIComponent(urlPath.split("/").pop() ?? "download");
  const size = item.size || item.fileSize || item.file_size || 0;

  return { url: cdnUrl, fileName, size };
}

/**
 * Download a file from a CDN URL to a local path. Streams the response.
 * Returns the absolute path of the saved file.
 */
export async function downloadToFile(
  cdnUrl: string,
  destDir: string,
  fileName: string,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<string> {
  const { createWriteStream, mkdirSync, existsSync } = await import("node:fs");
  const path = await import("node:path");

  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
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
      if (done) break;
      fileStream.write(Buffer.from(value));
      downloaded += value.length;
      onProgress?.(downloaded, contentLength);
    }
  } finally {
    fileStream.end();
    reader.releaseLock();
  }

  // Wait for the write stream to finish
  await new Promise<void>((resolve, reject) => {
    fileStream.on("finish", resolve);
    fileStream.on("error", reject);
  });

  return destPath;
}

// ---- helpers ---------------------------------------------------------------

const gameIdCache = new Map<string, number>();

export async function resolveGameId(domainName: string): Promise<number> {
  const cached = gameIdCache.get(domainName);
  if (cached !== undefined) return cached;
  const data = await gql<{ game: { id: number } | null }>(
    `query ($domainName: String!) { game(domainName: $domainName) { id } }`,
    { domainName },
  );
  if (!data.game) throw new NexusError(`Unknown game domain: "${domainName}"`);
  gameIdCache.set(domainName, data.game.id);
  return data.game.id;
}

/** Unix seconds → ISO date string (Nexus ModFile.date is an Int). */
export function isoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}
