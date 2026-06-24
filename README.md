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

Three options:

### Option A: Personal API Key

`NEXUS_MODS_API_KEY` — from [nexusmods.com/users/myaccount?tab=api](https://www.nexusmods.com/users/myaccount?tab=api).
Enables v1 REST download API + viewer-relative GraphQL fields.

### Option B: Browser Cookies (no API key needed)

Run the helper script once to log in:

```sh
node scripts/login.mjs
```

This launches Chrome, you log in, cookies are saved to `~/.nexus-mcp-cookies.json`.
The MCP server reads this file automatically.

### Option C: Standalone CLI (no Claude Code needed)

The `nexus-cli.mjs` tool works completely independently:

```sh
node scripts/nexus-cli.mjs login                           # one-time login
node scripts/nexus-cli.mjs search skyrim "unofficial patch" # search mods
node scripts/nexus-cli.mjs download skyrim 266              # download mod
node scripts/nexus-cli.mjs download baldursgate3 1234 --dir ./mods
```

Cookies stored at `~/.nexus-mcp-cookies.json`, auto-refreshed when expired.

## Development

```sh
npm run dev               # run from source via tsx
node scripts/smoke.mjs    # end-to-end smoke test (needs build)
node scripts/login.mjs    # extract Nexus Mods cookies from Chrome
node scripts/nexus-cli.mjs login  # standalone login
```

Domain terminology lives in `CONTEXT.md`.
