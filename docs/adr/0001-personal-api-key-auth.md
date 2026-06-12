# Authenticate with a personal API key header, not OAuth

The Nexus Mods docs steer v2 GraphQL users toward OAuth bearer tokens, but the
endpoint (`https://api.nexusmods.com/v2/graphql` — note: *not*
`graphql.nexusmods.com`, which is only the docs site) also accepts a personal
API key via the `apikey` request header; we verified this live. Since this
server is single-user, local, and read-only, we use the key from
`NEXUS_MODS_API_KEY` and skip OAuth entirely — no token refresh, no app
registration, no callback flow.

## Consequences

- Authentication is optional: every discovery tool works anonymously; the key
  only adds viewer-relative fields (`viewerEndorsed`, `viewerTracked`, …).
- If this ever becomes multi-user or hosted, OAuth becomes necessary and the
  auth layer must be revisited.
- The key contains `=` characters — naive `KEY=value` parsing that splits on
  `=` will silently truncate it (this bit us during design).
