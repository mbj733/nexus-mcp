#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { gql, resolveGameId, isoDate } from "./nexus.js";
import { bbcodeToText } from "./bbcode.js";

const server = new McpServer({ name: "nexus-mods", version: "0.1.0" });

const hasApiKey = Boolean(process.env.NEXUS_MODS_API_KEY?.trim());

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }] };
}

const gameDomainParam = z
  .string()
  .describe(
    'Game domain name as used in nexusmods.com URLs, e.g. "skyrimspecialedition", "newvegas". Use search_games to resolve a game title to its domain.',
  );

// ---------------------------------------------------------------- search_mods

const MOD_SORTS = {
  endorsements: { endorsements: { direction: "DESC" } },
  downloads: { downloads: { direction: "DESC" } },
  updatedAt: { updatedAt: { direction: "DESC" } },
  createdAt: { createdAt: { direction: "DESC" } },
  relevance: { relevance: { direction: "DESC" } },
} as const;

server.registerTool(
  "search_mods",
  {
    title: "Search mods",
    description:
      "Search Nexus Mods for mods by name, game, author, or tag. Returns summaries with stats; use get_mod for full details. Adult content is always included.",
    inputSchema: {
      query: z.string().optional().describe("Text to match against mod names (substring match)"),
      gameDomain: gameDomainParam.optional(),
      author: z.string().optional().describe("Filter by author name (exact)"),
      tag: z.string().optional().describe("Filter by tag name (exact)"),
      sortBy: z.enum(["endorsements", "downloads", "updatedAt", "createdAt", "relevance"]).default("endorsements"),
      offset: z.number().int().min(0).default(0),
      count: z.number().int().min(1).max(50).default(10),
    },
  },
  async ({ query, gameDomain, author, tag, sortBy, offset, count }) => {
    const filter: Record<string, unknown> = {};
    if (query) filter.name = [{ value: query, op: "WILDCARD" }];
    if (gameDomain) filter.gameDomainName = [{ value: gameDomain, op: "EQUALS" }];
    if (author) filter.author = [{ value: author, op: "EQUALS" }];
    if (tag) filter.tag = [{ value: tag, op: "EQUALS" }];

    const data = await gql<{ mods: { totalCount: number; nodes: Record<string, unknown>[] } }>(
      `query ($filter: ModsFilter, $sort: [ModsSort!], $offset: Int, $count: Int) {
        mods(filter: $filter, sort: $sort, offset: $offset, count: $count) {
          totalCount
          nodes {
            modId name version summary author uploader { name }
            game { domainName } endorsements downloads updatedAt adultContent
          }
        }
      }`,
      { filter, sort: [MOD_SORTS[sortBy]], offset, count },
    );
    return jsonResult(data.mods);
  },
);

// -------------------------------------------------------------------- get_mod

server.registerTool(
  "get_mod",
  {
    title: "Get mod details",
    description:
      "Get full details for one mod: description, requirements, tags, stats. Identify the mod by game domain + mod ID (both appear in nexusmods.com URLs and search_mods results).",
    inputSchema: {
      gameDomain: gameDomainParam,
      modId: z.number().int().describe("Numeric mod ID within the game"),
      maxDescriptionChars: z.number().int().min(0).default(8000),
    },
  },
  async ({ gameDomain, modId, maxDescriptionChars }) => {
    const gameId = await resolveGameId(gameDomain);
    const viewerFields = hasApiKey ? "viewerEndorsed viewerTracked viewerDownloaded" : "";
    const data = await gql<{ mods: { nodes: (Record<string, unknown> & { description?: string })[] } }>(
      `query ($filter: ModsFilter) {
        mods(filter: $filter, count: 1) {
          nodes {
            uid modId name version summary description author uploader { name memberId }
            game { domainName name id } endorsements downloads fileSize
            createdAt updatedAt adultContent status pictureUrl
            tags { name }
            modRequirements { nexusRequirements { nodes { modName url notes externalRequirement } } }
            ${viewerFields}
          }
        }
      }`,
      {
        filter: {
          modId: [{ value: String(modId), op: "EQUALS" }],
          gameId: [{ value: String(gameId), op: "EQUALS" }],
        },
      },
    );
    const mod = data.mods.nodes[0];
    if (!mod) return jsonResult({ error: `Mod ${modId} not found for game "${gameDomain}"` });
    if (typeof mod.description === "string") {
      mod.description = bbcodeToText(mod.description, maxDescriptionChars);
    }
    const reqs = mod.modRequirements as { nexusRequirements?: { nodes?: unknown[] } } | null;
    (mod as Record<string, unknown>).requirements = reqs?.nexusRequirements?.nodes ?? [];
    delete (mod as Record<string, unknown>).modRequirements;
    (mod as Record<string, unknown>).url = `https://www.nexusmods.com/${gameDomain}/mods/${modId}`;
    return jsonResult(mod);
  },
);

// -------------------------------------------------------------- get_mod_files

server.registerTool(
  "get_mod_files",
  {
    title: "List mod files",
    description:
      "List the downloadable files of a mod (main/optional/old versions) with sizes, dates, descriptions, and changelogs.",
    inputSchema: {
      gameDomain: gameDomainParam,
      modId: z.number().int().describe("Numeric mod ID within the game"),
      includeOldVersions: z.boolean().default(false).describe("Include OLD_VERSION and ARCHIVED files"),
    },
  },
  async ({ gameDomain, modId, includeOldVersions }) => {
    const gameId = await resolveGameId(gameDomain);
    const data = await gql<{
      modFiles: {
        fileId: number; name: string; version: string; category: string;
        date: number; sizeInBytes: string | null; description: string | null;
        changelogText: string[]; totalDownloads: number; primary: number;
      }[];
    }>(
      `query ($modId: ID!, $gameId: ID!) {
        modFiles(modId: $modId, gameId: $gameId) {
          fileId name version category date sizeInBytes description
          changelogText totalDownloads primary
        }
      }`,
      { modId: String(modId), gameId: String(gameId) },
    );
    const files = data.modFiles
      .filter((f) => includeOldVersions || !["OLD_VERSION", "ARCHIVED", "REMOVED"].includes(f.category))
      .map((f) => ({
        fileId: f.fileId,
        name: f.name,
        version: f.version,
        category: f.category,
        date: isoDate(f.date),
        sizeInBytes: f.sizeInBytes,
        primary: f.primary === 1,
        totalDownloads: f.totalDownloads,
        description: f.description ? bbcodeToText(f.description, 1000) : null,
        changelog: f.changelogText.length ? f.changelogText : undefined,
      }));
    return jsonResult({ count: files.length, files });
  },
);

// --------------------------------------------------------- search_collections

const COLLECTION_SORTS = {
  endorsements: { endorsements: { direction: "DESC" } },
  downloads: { downloads: { direction: "DESC" } },
  rating: { rating: { direction: "DESC" } },
  updatedAt: { updatedAt: { direction: "DESC" } },
  relevance: { relevance: { direction: "DESC" } },
} as const;

server.registerTool(
  "search_collections",
  {
    title: "Search collections",
    description:
      "Search Nexus Mods collections (curated mod lists) by text and game. Use get_collection with a result's slug to see its mod list.",
    inputSchema: {
      query: z.string().optional().describe("Full-text search over collection name/summary"),
      gameDomain: gameDomainParam.optional(),
      sortBy: z.enum(["endorsements", "downloads", "rating", "updatedAt", "relevance"]).default("endorsements"),
      offset: z.number().int().min(0).default(0),
      count: z.number().int().min(1).max(50).default(10),
    },
  },
  async ({ query, gameDomain, sortBy, offset, count }) => {
    const filter: Record<string, unknown> = {};
    if (query) filter.generalSearch = [{ value: query, op: "WILDCARD" }];
    if (gameDomain) filter.gameDomain = [{ value: gameDomain, op: "EQUALS" }];

    const data = await gql<{ collectionsV2: { totalCount: number; nodes: unknown[] } }>(
      `query ($filter: CollectionsSearchFilter, $sort: [CollectionsSearchSort!], $offset: Int, $count: Int) {
        collectionsV2(filter: $filter, sort: $sort, offset: $offset, count: $count) {
          totalCount
          nodes {
            name slug summary endorsements totalDownloads overallRating overallRatingCount
            game { domainName } user { name } category { name } updatedAt
            latestPublishedRevision { revisionNumber modCount adultContent }
          }
        }
      }`,
      { filter, sort: [COLLECTION_SORTS[sortBy]], offset, count },
    );
    return jsonResult(data.collectionsV2);
  },
);

// ------------------------------------------------------------- get_collection

const MOD_LIST_CAP = 300;

server.registerTool(
  "get_collection",
  {
    title: "Get collection details",
    description:
      "Get a collection's metadata and full mod list by slug (from search_collections or a nexusmods.com/collections URL). Optionally a specific revision number.",
    inputSchema: {
      slug: z.string().describe("Collection slug"),
      revision: z.number().int().optional().describe("Revision number; defaults to latest published"),
      includeModList: z.boolean().default(true),
      modListOffset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Skip this many mods (alphabetical order) when the list is truncated"),
    },
  },
  async ({ slug, revision, includeModList, modListOffset }) => {
    const modFilesSel = includeModList
      ? `modFiles { optional version file { name version modId mod { modId name } } }`
      : "";
    const revisionSel = `
      revisionNumber adultContent modCount createdAt gameVersions { reference }
      installationInfo ${modFilesSel}`;

    type RevisionData = {
      revisionNumber: number;
      installationInfo: string | null;
      modFiles?: {
        optional: boolean;
        version: string;
        file: { name: string; version: string; modId: number; mod: { modId: number; name: string } | null } | null;
      }[];
      [k: string]: unknown;
    };

    const data = await gql<{ collection: (Record<string, unknown> & { description?: string; latestPublishedRevision?: RevisionData }) | null }>(
      `query ($slug: String) {
        collection(slug: $slug, viewAdultContent: true) {
          name slug summary description endorsements totalDownloads
          overallRating overallRatingCount createdAt updatedAt
          game { domainName name } user { name } category { name } tags { name }
          ${revision === undefined ? `latestPublishedRevision { ${revisionSel} }` : ""}
        }
      }`,
      { slug },
    );
    if (!data.collection) return jsonResult({ error: `Collection "${slug}" not found` });
    const col = data.collection;

    let rev: RevisionData | undefined = col.latestPublishedRevision;
    delete col.latestPublishedRevision;
    if (revision !== undefined) {
      const revData = await gql<{ collectionRevision: RevisionData | null }>(
        `query ($slug: String, $revision: Int) {
          collectionRevision(slug: $slug, revision: $revision, viewAdultContent: true) { ${revisionSel} }
        }`,
        { slug, revision },
      );
      if (!revData.collectionRevision) {
        return jsonResult({ error: `Revision ${revision} of collection "${slug}" not found` });
      }
      rev = revData.collectionRevision;
    }

    if (typeof col.description === "string") col.description = bbcodeToText(col.description, 4000);
    if (rev && typeof rev.installationInfo === "string") {
      rev.installationInfo = bbcodeToText(rev.installationInfo, 2000);
    }

    let modList: unknown[] | undefined;
    let modListNote: string | undefined;
    if (rev?.modFiles) {
      // A collection pins individual files, and one mod often contributes
      // several (main file + patches) — group them so each mod appears once.
      type ModGroup = { mod: string; modId: number | undefined; files: unknown[] };
      const byMod = new Map<number | string, ModGroup>();
      for (const mf of rev.modFiles) {
        const modId = mf.file?.mod?.modId;
        const modName = mf.file?.mod?.name ?? mf.file?.name ?? "(unknown)";
        const key = modId ?? modName;
        let group = byMod.get(key);
        if (!group) {
          group = { mod: modName, modId, files: [] };
          byMod.set(key, group);
        }
        group.files.push({
          file: mf.file?.name !== modName ? mf.file?.name : undefined,
          version: mf.file?.version ?? mf.version,
          optional: mf.optional || undefined,
        });
      }
      const groups = [...byMod.values()].sort((a, b) => a.mod.localeCompare(b.mod));
      modList = groups.slice(modListOffset, modListOffset + MOD_LIST_CAP);
      if (modListOffset > 0 || groups.length > modListOffset + MOD_LIST_CAP) {
        modListNote =
          `Showing mods ${modListOffset + 1}–${modListOffset + modList.length} of ` +
          `${groups.length} unique mods (${rev.modFiles.length} files total); ` +
          `use modListOffset to page`;
      }
      delete rev.modFiles;
    }

    (col as Record<string, unknown>).url =
      `https://www.nexusmods.com/games/${(col.game as { domainName: string }).domainName}/collections/${slug}`;
    return jsonResult({ ...col, revision: rev, modListNote, modList });
  },
);

// ---------------------------------------------------------------------- games

server.registerTool(
  "search_games",
  {
    title: "Search games",
    description:
      "Find games on Nexus Mods by name; returns their domain names (needed by the other tools), mod counts, and collection counts. Without a query, returns the most-modded games.",
    inputSchema: {
      query: z.string().optional().describe("Game name to match (substring)"),
      count: z.number().int().min(1).max(50).default(10),
    },
  },
  async ({ query, count }) => {
    const filter = query ? { name: [{ value: query, op: "WILDCARD" }] } : undefined;
    const data = await gql<{ games: { totalCount: number; nodes: unknown[] } }>(
      `query ($filter: GamesSearchFilter, $count: Int) {
        games(filter: $filter, sort: [{ mods: { direction: DESC } }], count: $count) {
          totalCount
          nodes { id name domainName modCount collectionCount genre }
        }
      }`,
      { filter, count },
    );
    return jsonResult(data.games);
  },
);

// ------------------------------------------------------------------- get_user

server.registerTool(
  "get_user",
  {
    title: "Get user profile",
    description:
      "Look up a Nexus Mods user by exact username; returns their profile and most-endorsed mods.",
    inputSchema: {
      name: z.string().describe("Exact username"),
      modCount: z.number().int().min(0).max(50).default(10).describe("How many of their top mods to include"),
    },
  },
  async ({ name, modCount }) => {
    const data = await gql<{ userByName: { memberId: number; [k: string]: unknown } | null }>(
      `query ($name: String!) {
        userByName(name: $name) {
          memberId name avatar about country joined kudos posts
          modCount collectionCount recognizedAuthor uniqueModDownloads
        }
      }`,
      { name },
    );
    if (!data.userByName) return jsonResult({ error: `User "${name}" not found` });
    const user = data.userByName;

    let topMods: unknown[] = [];
    if (modCount > 0) {
      const mods = await gql<{ mods: { nodes: unknown[] } }>(
        `query ($filter: ModsFilter, $count: Int) {
          mods(filter: $filter, sort: [{ endorsements: { direction: DESC } }], count: $count) {
            nodes { modId name version summary game { domainName } endorsements downloads updatedAt }
          }
        }`,
        { filter: { uploaderId: [{ value: String(user.memberId), op: "EQUALS" }] }, count: modCount },
      );
      topMods = mods.mods.nodes;
    }
    return jsonResult({ ...user, topMods });
  },
);

// ---------------------------------------------------------------- run_graphql

server.registerTool(
  "run_graphql",
  {
    title: "Run GraphQL query",
    description:
      "Escape hatch: run an arbitrary read-only GraphQL query against the Nexus Mods v2 API (api.nexusmods.com/v2/graphql). Mutations are rejected. Use introspection (__schema/__type) to discover fields not covered by the other tools. Keep selections small — responses are returned verbatim.",
    inputSchema: {
      query: z.string().describe("GraphQL query document (no mutations)"),
      variables: z.record(z.string(), z.unknown()).optional(),
    },
  },
  async ({ query, variables }) => {
    const withoutStringsAndComments = query
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/#[^\n]*/g, "");
    if (/\bmutation\b/i.test(withoutStringsAndComments)) {
      return jsonResult({ error: "Mutations are not allowed; this server is read-only." });
    }
    const data = await gql(query, variables ?? {});
    return jsonResult(data);
  },
);

// ----------------------------------------------------------------------- main

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `nexus-mcp ready (auth: ${hasApiKey ? "personal API key" : "anonymous — set NEXUS_MODS_API_KEY for viewer data"})`,
);
