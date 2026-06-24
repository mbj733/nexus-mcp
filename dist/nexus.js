/**
 * Thin client for the Nexus Mods v2 GraphQL API.
 *
 * Endpoint is api.nexusmods.com/v2/graphql (graphql.nexusmods.com is only the
 * docs site). Auth is an optional personal API key sent as the `apikey`
 * header — see docs/adr/0001-personal-api-key-auth.md.
 */
const ENDPOINT = "https://api.nexusmods.com/v2/graphql";
const USER_AGENT = "nexus-mcp/0.1.0 (local MCP server)";
export class NexusError extends Error {
}
export async function gql(query, variables = {}) {
    const headers = {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
    };
    const apiKey = process.env.NEXUS_MODS_API_KEY?.trim();
    if (apiKey)
        headers["apikey"] = apiKey;
    const res = await fetch(ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
        throw new NexusError(`Nexus API HTTP ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json());
    if (body.errors?.length) {
        const msgs = body.errors
            .map((e) => (e.path ? `${e.path.join(".")}: ${e.message}` : e.message))
            .join("; ");
        if (body.data == null)
            throw new NexusError(`Nexus API error: ${msgs}`);
        // Partial data: surface errors but keep going.
        console.error(`nexus-mcp: partial GraphQL errors: ${msgs}`);
    }
    if (body.data == null)
        throw new NexusError("Nexus API returned no data");
    return body.data;
}
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
