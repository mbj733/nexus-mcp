// End-to-end smoke test: spawns the built server over stdio and calls each tool.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env },
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

const calls = [
  ["search_games", { query: "skyrim" }],
  ["search_mods", { query: "unofficial patch", gameDomain: "skyrimspecialedition", count: 3 }],
  ["get_mod", { gameDomain: "skyrimspecialedition", modId: 266, maxDescriptionChars: 500 }],
  ["get_mod_files", { gameDomain: "skyrimspecialedition", modId: 266 }],
  ["search_collections", { query: "vanilla plus", gameDomain: "skyrimspecialedition", count: 3 }],
  ["get_user", { name: "Arthmoor", modCount: 3 }],
  ["run_graphql", { query: "{ news(count: 1) { nodes { title } } }" }],
  ["run_graphql", { query: "mutation { endorse } " }],
];

let collectionSlug;
for (const [name, args] of calls) {
  try {
    const res = await client.callTool({ name, arguments: args });
    const text = res.content[0].text;
    console.log(`\n=== ${name} ${res.isError ? "(isError)" : "OK"} — ${text.length} chars`);
    console.log(text.slice(0, 700));
    if (name === "search_collections") {
      const parsed = JSON.parse(text);
      collectionSlug = parsed.nodes?.[0]?.slug;
    }
  } catch (e) {
    console.log(`\n=== ${name} FAILED: ${e.message}`);
  }
}

if (collectionSlug) {
  const res = await client.callTool({
    name: "get_collection",
    arguments: { slug: collectionSlug },
  });
  const text = res.content[0].text;
  console.log(`\n=== get_collection(${collectionSlug}) ${res.isError ? "(isError)" : "OK"} — ${text.length} chars`);
  console.log(text.slice(0, 900));
}

await client.close();
