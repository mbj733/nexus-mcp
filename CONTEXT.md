# Nexus Mods MCP Server

A local MCP server exposing Nexus Mods (v2 GraphQL API) to AI assistants for
read-only mod discovery and research.

## Language

**Game domain name**:
The canonical string identifier for a game on Nexus Mods (e.g. `skyrimspecialedition`).
_Avoid_: game name, game slug, game ID (the numeric ID is a different field)

**Mod**:
A single published modification for one game, addressed by (game, mod ID); the mod ID is only unique within its game.

**Mod UID**:
A globally unique mod identifier encoding both game and mod ID, used by bulk lookup queries.

**Mod file**:
A downloadable archive belonging to a mod; a mod typically has several (main, optional, old versions).
_Avoid_: download, archive

**Collection**:
A curated, shareable mod list for one game, identified by a slug and versioned through revisions.
_Avoid_: modlist, mod pack

**Revision**:
A numbered, immutable snapshot of a collection's mod list. "The collection" usually means its latest published revision.
_Avoid_: collection version

**Endorsement**:
A user's thumbs-up on a mod; the primary community quality signal and default search ranking.
_Avoid_: like, upvote, rating

**Adult content**:
Mods flagged as adult, which the API hides unless explicitly requested. This server always requests them.

**Viewer**:
The authenticated user context; mod results carry viewer-relative fields only when a request is authenticated.
_Avoid_: current user, logged-in user

**Personal API key**:
A long-lived key a user generates for themselves (vs. OAuth application credentials), sent as the `apikey` request header.
_Avoid_: token, OAuth token
