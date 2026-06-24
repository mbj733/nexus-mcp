#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { gql, resolveGameId, isoDate, getDownloadLink, downloadToFile } from "./nexus.js";
import { bbcodeToText } from "./bbcode.js";
const server = new McpServer({ name: "nexus-mods", version: "0.1.0" });
const hasApiKey = Boolean(process.env.NEXUS_MODS_API_KEY?.trim());
function jsonResult(data) {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 1) }] };
}
const gameDomainParam = z
    .string()
    .describe('Game domain name as used in nexusmods.com URLs, e.g. "skyrimspecialedition", "newvegas". Use search_games to resolve a game title to its domain.');
const MOD_SORTS = {
    endorsements: { endorsements: { direction: "DESC" } },
    downloads: { downloads: { direction: "DESC" } },
    updatedAt: { updatedAt: { direction: "DESC" } },
    createdAt: { createdAt: { direction: "DESC" } },
    relevance: { relevance: { direction: "DESC" } },
};
server.registerTool("search_mods", {
    title: "Search mods",
    description: "Search Nexus Mods for mods by name, game, author, or tag — or batch-fetch specific mods via modIds. Returns summaries with stats; use get_mod for full details. Adult content is always included.",
    inputSchema: {
        query: z.string().optional().describe("Text to match against mod names (substring match)"),
        gameDomain: gameDomainParam.optional(),
        author: z.string().optional().describe("Filter by author name (exact)"),
        tag: z.string().optional().describe("Filter by tag name (exact)"),
        modIds: z
            .array(z.number().int())
            .max(50)
            .optional()
            .describe("Batch-fetch these specific mod IDs (requires gameDomain). When set, query/author/tag are ignored."),
        sortBy: z.enum(["endorsements", "downloads", "updatedAt", "createdAt", "relevance"]).default("endorsements"),
        offset: z.number().int().min(0).default(0),
        count: z.number().int().min(1).max(50).default(10),
    },
}, async ({ query, gameDomain, author, tag, modIds, sortBy, offset, count })=>{
    let filter = {};
    if (modIds?.length) {
        if (!gameDomain) {
            return jsonResult({ error: "modIds requires gameDomain to be set" });
        }
        const gameId = await resolveGameId(gameDomain);
        filter = {
            op: "OR",
            filter: modIds.map((id)=>({
                    modId: [
                        { value: String(id), op: "EQUALS" }
                    ],
                    gameId: [
                        { value: String(gameId), op: "EQUALS" }
                    ],
                })),
        };
        count = Math.max(count, modIds.length);
    } else {
        if (query) filter.nameStemmed = [
            { value: query, op: "MATCHES" }
        ];
        if (gameDomain) filter.gameDomainName = [
            { value: gameDomain, op: "EQUALS" }
        ];
        if (author) filter.author = [
            { value: author, op: "EQUALS" }
        ];
        if (tag) filter.tag = [
            { value: tag, op: "EQUALS" }
        ];
    }
    const data = await gql(`query ($filter: ModsFilter, $sort: [ModsSort!], $offset: Int, $count: Int) {
        mods(filter: $filter, sort: $sort, offset: $offset, count: $count) {
          totalCount
          nodes {
            modId name version summary author uploader { name }
            game { domainName } endorsements downloads updatedAt adultContent
          }
        }
      }`, {
        filter,
        sort: [
            MOD_SORTS[sortBy]
        ],
        offset,
        count
    });
    return jsonResult(data.mods);
});