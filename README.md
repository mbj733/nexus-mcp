# nexus-mcp

A local MCP server for [Nexus Mods](https://www.nexusmods.com) mod discovery and
research, backed by the v2 GraphQL API (`api.nexusmods.com/v2/graphql`).
Read-only by design.

## Tools

| Tool | Purpose |
|---|---|
| `search_games` | Resolve game titles to domain names; browse most-modded games |
| `search_mods` | Search mods by name/game/author/tag, sorted by endorsements etc. |
| `get_mod` | Full mod details: description, requirements, tags, stats |
| `get_mod_files` | A mod's downloadable files with versions and changelogs |
| `search_collections` | Search curated mod lists |
| `get_collection` | Collection metadata + full mod list (by slug, optional revision) |
| `get_user` | User profile + their most-endorsed mods |
| `run_graphql` | Escape hatch: any read-only GraphQL query (mutations rejected) |

Adult content is always included — there is no filtering toggle.

## Setup

```sh
npm install
npm run build
```

Register with Claude Code:

```sh
claude mcp add nexus-mods -e NEXUS_MODS_API_KEY=<your key> -- node /home/matthew/src/nexus-mcp/dist/index.js
```

Or in Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nexus-mods": {
      "command": "node",
      "args": ["/home/matthew/src/nexus-mcp/dist/index.js"],
      "env": { "NEXUS_MODS_API_KEY": "<your key>" }
    }
  }
}
```

## Authentication

`NEXUS_MODS_API_KEY` is **optional** — every tool works anonymously. When set
(a [personal API key](https://www.nexusmods.com/users/myaccount?tab=api)), it is
sent as the `apikey` header and unlocks viewer-relative fields
(`viewerEndorsed`, `viewerTracked`, `viewerDownloaded`) on `get_mod`.
See `docs/adr/0001-personal-api-key-auth.md` for why this server skips OAuth.

## Development

```sh
npm run dev               # run from source via tsx
node scripts/smoke.mjs    # end-to-end smoke test against the live API (needs build)
```

Domain terminology lives in `CONTEXT.md`.
