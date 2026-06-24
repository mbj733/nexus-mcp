# nexus-mcp

A local MCP server for [Nexus Mods](https://www.nexusmods.com) mod discovery,
research, and downloading, backed by the v2 GraphQL API (`api.nexusmods.com/v2/graphql`)
and the website's DownloadPopUp widget.

## Tools

| Tool | Purpose |
|---|---|
| `search_games` | Resolve game titles to domain names; browse most-modded games |
| `search_mods` | Search mods by name/game/author/tag, sorted by endorsements etc. |
| `get_mod` | Full mod details: description, requirements, tags, stats |
| `get_mod_files` | A mod's downloadable files with versions and changelogs |
| `get_download_url` | Get a pre-signed CDN download URL (needs API key or cookies) |
| `download_mod` | Download a mod file to disk (needs API key or cookies) |
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

Register with Claude Code (local checkout):

```sh
claude mcp add nexus-mods -e NEXUS_MODS_API_KEY=<your key> -- node dist/index.js
```

Or run directly via npx (no checkout needed — the repo is public):

```sh
claude mcp add nexus-mods -e NEXUS_MODS_API_KEY=<your key> -- npx github:mbj733/nexus-mcp
```

Or in Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nexus-mods": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": { "NEXUS_MODS_API_KEY": "<your key>" }
    }
  }
}
```

## Authentication

Two options:

### Option A: Personal API Key (recommended)

`NEXUS_MODS_API_KEY` — generated at [nexusmods.com/users/myaccount?tab=api](https://www.nexusmods.com/users/myaccount?tab=api).
When set, it is sent as the `APIKEY` header and unlocks viewer-relative fields
(`viewerEndorsed`, `viewerTracked`, `viewerDownloaded`) on `get_mod`, plus
enables the v1 REST download API.
See `docs/adr/0001-personal-api-key-auth.md` for why this server skips OAuth.

### Option B: Browser Cookies (fallback for download)

If you don't have an API key, use browser cookies instead. Run the helper script:

```sh
node scripts/login.mjs
```

This launches Chrome → you log in manually → it extracts the cookies and prints
the `NEXUS_COOKIES` value. Paste that into your MCP config.

Both `NEXUS_MODS_API_KEY` and `NEXUS_COOKIES` can be set together — the server
tries the API key first, then falls back to cookies for downloads.

## Development

```sh
npm run dev               # run from source via tsx
node scripts/smoke.mjs    # end-to-end smoke test against the live API (needs build)
node scripts/login.mjs    # extract Nexus Mods cookies from Chrome
```

Domain terminology lives in `CONTEXT.md`.
