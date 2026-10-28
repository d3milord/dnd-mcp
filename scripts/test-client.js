// Client di prova: si collega a un endpoint MCP, elenca gli strumenti e li chiama.
//   node scripts/test-client.js [url]      (default: http://localhost:8787/mcp)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.argv[2] ?? "http://localhost:8787/mcp";
const client = new Client({ name: "test-client", version: "0.0.1" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const textOf = (r) => r.content.map((c) => c.text).join("\n");
const call = async (name, args) => {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args });
  return { text: textOf(r), isError: !!r.isError, ms: Date.now() - t0 };
};

const tools = (await client.listTools()).tools.map((t) => t.name);
check("listTools", ["cerca_nel_manuale", "leggi_voce", "elenca_categoria", "info_manuale"].every((t) => tools.includes(t)), tools.join(", "));

let r = await call("info_manuale", {});
check("info_manuale (contenuto per manuale)", /MANUALI CARICATI/.test(r.text) && /## Manuale dei Mostri \(2024\)\n- Mostri: 433 voci/.test(r.text) && /Classi \(12\): Barbaro/.test(r.text) && /Homerule di campagna/.test(r.text), `${r.ms}ms`);

const searches = [
  ["palla di fuoco", null, /Palla di Fuoco/i],
  ["ira del barbaro livello 1", null, /ira/i],
  ["condizione accecato", null, /accecato/i],
  ["resurrezione entro 24 ore", null, /HOMERULE/],
  ["troll", "mostri", /troll/i],
  ["pergamene magiche senza limite di livello", null, /HOMERULE/],
];
for (const [query, categoria, expect] of searches) {
  r = await call("cerca_nel_manuale", { query, ...(categoria ? { categoria } : {}) });
  check(`cerca "${query}"${categoria ? ` [${categoria}]` : ""}`, !r.isError && expect.test(r.text), `${r.ms}ms`);
}

r = await call("leggi_voce", { titolo: "Palla di Fuoco" });
check("leggi_voce Palla di Fuoco", !r.isError && /8d6|danni da fuoco/i.test(r.text), `${r.text.length} caratteri, ${r.ms}ms`);

r = await call("leggi_voce", { titolo: "Spettro" });
check("leggi_voce Spettro (mostro)", !r.isError && /GS 1|Non morto/i.test(r.text), `${r.ms}ms`);

r = await call("leggi_voce", { titolo: "Troll" });
check("fonte: Troll -> Manuale dei Mostri", /MANUALE: Manuale dei Mostri \(2024\)/.test(r.text));

r = await call("cerca_nel_manuale", { query: "palla di fuoco", categoria: "incantesimi", limite: 1 });
check("fonte: Palla di Fuoco -> Manuale del Giocatore, senza pagina", /MANUALE: Manuale del Giocatore \(2024\)\n/.test(r.text) && !/pag\./i.test(r.text.split("categoria:")[0]));

r = await call("cerca_nel_manuale", { query: "resurrezione entro 24 ore", limite: 1 });
check("fonte: homerule", /MANUALE: Homerule di campagna/.test(r.text));

r = await call("leggi_voce", { titolo: "xyzzy inesistente" });
check("leggi_voce inesistente", /Nessuna voce/.test(r.text));

r = await call("elenca_categoria", { categoria: "talenti", filtro: "lotta" });
check("elenca_categoria talenti 'lotta'", /Lottatore/i.test(r.text), `${r.ms}ms`);

r = await call("elenca_categoria", { categoria: "categoria-finta" });
check("categoria sconosciuta → errore", r.isError);

console.log("\n--- esempio: cerca 'cosa fa palla di fuoco' ---");
r = await call("cerca_nel_manuale", { query: "cosa fa palla di fuoco", limite: 2 });
console.log(r.text.slice(0, 1500));

await client.close();
console.log(failures === 0 ? "\nTutti i controlli superati" : `\n${failures} controlli falliti`);
process.exit(failures === 0 ? 0 : 1);
