// Strumenti MCP (sola lettura) sul manuale D&D 2024 ITA.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readQuery } from "./db.js";

// Categorie del DB: nome enum -> descrizione per Claude.
export const CATEGORIES = {
  SPELLS: "incantesimi (un file per incantesimo)",
  MONSTERS: "mostri (stat block dal Manuale dei Mostri / Mordenkainen)",
  CREATURES: "schede creature (bestie, evocazioni: Manuale del Giocatore)",
  CLASSES: "classi (pagine riassuntive)",
  SUBCLASSES: "sottoclassi",
  PRIVILEGES: "privilegi di classe e sottoclasse, per livello",
  SPECIES: "specie (razze)",
  TRAITS: "tratti delle specie, varianti e tabelle",
  BACKGROUNDS: "background / origini",
  FEATS: "talenti",
  EQUIPMENT: "equipaggiamento (armi, armature, attrezzi)",
  MAGIC_ITEMS: "oggetti magici",
  GLOSSARY: "glossario delle regole (condizioni, azioni, termini)",
  RULES: "regole base, capitoli del manuale e HOMERULES di campagna",
  LORE: "ambientazione Forgotten Realms (fazioni, divinità, regioni, magia)",
};

// Alias italiani / varianti -> nome enum.
const ALIASES = {
  incantesimi: "SPELLS", incantesimo: "SPELLS", spells: "SPELLS",
  mostri: "MONSTERS", mostro: "MONSTERS", monsters: "MONSTERS",
  creature: "CREATURES", creatures: "CREATURES", "schede creature": "CREATURES",
  classi: "CLASSES", classe: "CLASSES", classes: "CLASSES",
  sottoclassi: "SUBCLASSES", sottoclasse: "SUBCLASSES", subclasses: "SUBCLASSES",
  privilegi: "PRIVILEGES", privilegio: "PRIVILEGES", privileges: "PRIVILEGES",
  specie: "SPECIES", razze: "SPECIES", species: "SPECIES",
  tratti: "TRAITS", tratto: "TRAITS", traits: "TRAITS",
  background: "BACKGROUNDS", backgrounds: "BACKGROUNDS", origini: "BACKGROUNDS",
  talenti: "FEATS", talento: "FEATS", feats: "FEATS",
  equipaggiamento: "EQUIPMENT", equipment: "EQUIPMENT",
  "oggetti magici": "MAGIC_ITEMS", oggetti_magici: "MAGIC_ITEMS", magic_items: "MAGIC_ITEMS",
  glossario: "GLOSSARY", glossary: "GLOSSARY",
  regole: "RULES", rules: "RULES", homerules: "RULES", homerule: "RULES",
  lore: "LORE", ambientazione: "LORE", "forgotten realms": "LORE",
};

export function resolveCategory(input) {
  if (!input) return null;
  const key = String(input).trim();
  if (CATEGORIES[key.toUpperCase()]) return key.toUpperCase();
  return ALIASES[key.toLowerCase()] ?? null;
}

const categoryList = Object.keys(CATEGORIES).join(", ");

// Etichette e ordine di visualizzazione delle categorie nel riepilogo per manuale.
const CATEGORY_LABELS = {
  CLASSES: "Classi",
  SUBCLASSES: "Sottoclassi",
  SPECIES: "Specie",
  TRAITS: "Tratti/varianti di specie",
  BACKGROUNDS: "Background",
  FEATS: "Talenti",
  SPELLS: "Incantesimi",
  SPELL_LISTS: "Liste incantesimi per classe",
  PRIVILEGES: "Privilegi di classe e sottoclasse",
  MONSTERS: "Mostri",
  CREATURES: "Schede creature",
  MAGIC_ITEMS: "Oggetti magici",
  EQUIPMENT: "Equipaggiamento (sezioni)",
  GLOSSARY: "Glossario regole",
  RULES: "Regole",
  LORE: "Lore Forgotten Realms",
};
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

// Note di completezza per i manuali caricati solo in parte (aggiornare se si aggiungono capitoli).
const PARTIAL = {
  "Guida del Dungeon Master (2024)": "parziale: oggetti magici e capitoli pp. 223–330",
  "Mordenkainen presenta - Mostri del multiverso": "parziale: specie e opzioni (pp. 6–37 circa)",
  "Forgotten Realms: Heroes of Faerûn — Player's Expansion": "parziale: specie, background, fazioni e lore",
  "Eberron: Forge of the Artificer": "parziale: opzioni selezionate (edizione non italiana)",
  "Ravenloft: The Horror Within (2024)": "parziale: opzioni selezionate",
};

const STOPWORDS = new Set(
  ("il lo la le gli i un una uno di del dello della dei degli delle da dal dalla dai dalle in nel nella nei nelle " +
    "su sul sulla sui sulle con per tra fra a al alla ai alle e ed o ma che chi cui come cosa fa fanno quale quali " +
    "quanto quanti quando dove è sono ha hanno può possono si mi ti ci mio tuo suo non più")
    .split(" "),
);

/** Parole significative di una query libera (minuscole, senza stopword, solo lettere/numeri). */
export function tokenize(text) {
  const tokens = (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (t) => t.length >= 2 && !STOPWORDS.has(t),
  );
  return [...new Set(tokens)].slice(0, 12);
}

export function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const clip = (text, max) =>
  text.length > max ? `${text.slice(0, max).trimEnd()}\n[...troncato: usa leggi_voce per il testo completo]` : text;

const asText = (text) => ({ content: [{ type: "text", text }] });
const asError = (text) => ({ content: [{ type: "text", text }], isError: true });

// --- Manuale di provenienza -------------------------------------------------
// Il manuale è il campo 'fonte' del file; senza fonte la voce è una homerule o una pagina di servizio.
const FONTE_SQL = `CASE
    WHEN coalesce("metadataJson"->>'fonte', '') <> '' THEN "metadataJson"->>'fonte'
    WHEN slug LIKE 'homerules-%' THEN '__homerule'
    ELSE '__servizio'
  END`;
// Le pagine non si indicano: nei dati spesso sono errate.

/** Unifica i nomi alternativi dello stesso libro. */
export function canonicalFonte(f) {
  return f.startsWith("Forgotten Realms: Heroes of Faer") ? "Forgotten Realms: Heroes of Faerûn — Player's Expansion" : f;
}

function fonteLabel(f) {
  if (f === "__homerule") return "Homerule di campagna (priorità sul manuale)";
  if (f === "__servizio") return "pagina di servizio del manuale";
  return f;
}

/** slug -> { fonte } per un gruppo di voci. */
async function sourcesBySlug(slugs) {
  const list = [...new Set(slugs.filter(Boolean))];
  if (list.length === 0) return new Map();
  const rows = await readQuery(
    `SELECT slug, ${FONTE_SQL} AS fonte FROM "Entry" WHERE slug = ANY($1)`,
    [list],
  );
  return new Map(rows.map((r) => [r.slug, { fonte: canonicalFonte(r.fonte) }]));
}

const sourceText = (s) => fonteLabel(s ? s.fonte : "__servizio");

/** Chunk che contengono i termini, prima con AND poi (se servono altri risultati) con OR. */
async function searchChunks(tokens, category, wanted) {
  const sql = `
    SELECT c.id, c."filePath", c.breadcrumb, c.text, c.position,
           e.category::text AS category, e.title, e.slug,
           ts_rank_cd(c.tsv, q.tsq)
             + 0.6 * (SELECT count(*) FROM unnest($2::text[]) t
                      WHERE lower(c.breadcrumb || ' ' || c."filePath") LIKE '%' || t || '%') AS score
    FROM "Chunk" c
    LEFT JOIN "Entry" e ON e.id = c."entryId"
    CROSS JOIN (SELECT to_tsquery('italian', $1) AS tsq) q
    WHERE c.tsv @@ q.tsq AND ($3::text IS NULL OR e.category::text = $3)
    ORDER BY score DESC
    LIMIT $4`;
  const fetch = wanted * 5;
  const seen = new Set();
  const rows = [];
  for (const op of [" & ", " | "]) {
    if (op === " | " && (tokens.length < 2 || rows.length >= wanted * 2)) break;
    const found = await readQuery(sql, [tokens.join(op), tokens, category, fetch]);
    for (const row of found) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        rows.push(row);
      }
    }
  }
  // Al massimo 2 chunk per file, per non riempire i risultati con un solo documento.
  const perFile = new Map();
  const picked = [];
  for (const row of rows) {
    const n = perFile.get(row.filePath) ?? 0;
    if (n < 2) {
      perFile.set(row.filePath, n + 1);
      picked.push(row);
    }
    if (picked.length >= wanted) break;
  }
  return picked;
}

export function buildServer() {
  const server = new McpServer(
    { name: "dnd-omnia-manuale", version: "0.1.0" },
    {
      instructions:
        "Manuale D&D 5e 2024 in italiano (Manuale del Giocatore, Guida del DM, Manuale dei Mostri, Mordenkainen, " +
        "Forgotten Realms) più le HOMERULE della campagna. Sola lettura.\n" +
        "Come usarlo: 1) cerca_nel_manuale con parole chiave italiane precise (nome dell'incantesimo/mostro/talento, " +
        "classe, livello); se non trovi nulla riprova con sinonimi o col solo nome. 2) leggi_voce per il testo completo " +
        "di una voce. 3) elenca_categoria per sfogliare (es. tutti i talenti). Le HOMERULE (categoria RULES, file " +
        "homerules/) hanno priorità assoluta sul manuale: cercale sempre quando una regola è in discussione. " +
        "Ogni risposta riporta il campo MANUALE (libro di provenienza): citalo sempre " +
        "all'utente insieme alla voce da cui prendi i dati; non indicare numeri di pagina (non sono affidabili). Non inventare numeri: se il manuale non lo dice, dillo.",
    },
  );

  server.registerTool(
    "cerca_nel_manuale",
    {
      title: "Cerca nel manuale",
      description:
        "Cerca per parole chiave nel manuale D&D 2024 ITA e nelle homerule. Restituisce i passaggi più pertinenti " +
        "(testo, voce di origine, categoria). Usa nomi precisi in italiano, es. 'palla di fuoco', 'ira barbaro livello 5', " +
        "'condizione accecato', 'troll'. Categorie filtrabili: " + categoryList + ".",
      inputSchema: {
        query: z.string().min(2).describe("Parole chiave da cercare, in italiano"),
        categoria: z.string().optional().describe(`Filtro opzionale: ${categoryList} (anche in italiano, es. 'incantesimi')`),
        limite: z.number().int().min(1).max(12).optional().describe("Numero di passaggi (default 6)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, categoria, limite }) => {
      const tokens = tokenize(query);
      if (tokens.length === 0) return asError("Nessuna parola significativa nella query: riformula con termini più specifici.");
      let category = null;
      if (categoria) {
        category = resolveCategory(categoria);
        if (!category) return asError(`Categoria '${categoria}' sconosciuta. Valide: ${categoryList}`);
      }
      const rows = await searchChunks(tokens, category, limite ?? 6);
      if (rows.length === 0) {
        return asText(
          `Nessun risultato per "${query}"${category ? ` in ${category}` : ""}. ` +
            "Prova con meno parole, un sinonimo, il nome esatto della voce, oppure senza filtro categoria.",
        );
      }
      const sources = await sourcesBySlug(rows.map((r) => r.slug));
      const out = rows.map((r, i) => {
        const home = r.filePath.startsWith("homerules/") ? " ⚠ HOMERULE (priorità sul manuale)" : "";
        const head = r.breadcrumb || r.title || r.filePath;
        return [
          `### ${i + 1}. ${head}${home}`,
          `MANUALE: ${sourceText(sources.get(r.slug))}`,
          `categoria: ${r.category ?? "—"} | voce: ${r.title ?? "—"} | slug: ${r.slug ?? "—"} | file: ${r.filePath}`,
          clip(r.text, 1800),
        ].join("\n");
      });
      return asText(`${rows.length} passaggi per "${query}":\n\n${out.join("\n\n---\n\n")}`);
    },
  );

  server.registerTool(
    "leggi_voce",
    {
      title: "Leggi una voce",
      description:
        "Restituisce il testo completo di una voce del manuale (incantesimo, mostro, talento, privilegio, specie, " +
        "oggetto magico, homerule...). Indica il titolo (es. 'Palla di Fuoco', 'Spettro', 'Lottatore') oppure lo " +
        "slug ottenuto da cerca_nel_manuale. Se più voci corrispondono, restituisce l'elenco per scegliere.",
      inputSchema: {
        titolo: z.string().optional().describe("Titolo o nome della voce"),
        slug: z.string().optional().describe("Slug esatto (dai risultati di ricerca)"),
        categoria: z.string().optional().describe("Per disambiguare omonimie"),
        offset: z.number().int().min(0).optional().describe("Caratteri da saltare, per continuare un testo lungo"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ titolo, slug, categoria, offset }) => {
      if (!titolo && !slug) return asError("Indica 'titolo' oppure 'slug'.");
      let category = null;
      if (categoria) {
        category = resolveCategory(categoria);
        if (!category) return asError(`Categoria '${categoria}' sconosciuta. Valide: ${categoryList}`);
      }

      let rows;
      if (slug) {
        rows = await readQuery(
          `SELECT id, title, slug, category::text AS category, "contentMarkdown" AS content
           FROM "Entry" WHERE slug = $1 AND ($2::text IS NULL OR category::text = $2) LIMIT 5`,
          [slug, category],
        );
      } else {
        const wanted = slugify(titolo);
        // tier 1: titolo esatto / "Tipo: Titolo" / nome file; tier 2: contiene
        rows = await readQuery(
          `SELECT id, title, slug, category::text AS category, "contentMarkdown" AS content,
                  CASE WHEN lower(title) = lower($1) OR lower(title) LIKE '%: ' || lower($1)
                            OR slug LIKE '%-' || $3 THEN 1 ELSE 2 END AS tier
           FROM "Entry"
           WHERE ($2::text IS NULL OR category::text = $2)
             AND (lower(title) = lower($1) OR lower(title) LIKE '%: ' || lower($1)
                  OR slug LIKE '%-' || $3 OR title ILIKE '%' || $1 || '%')
           ORDER BY tier, length(title) LIMIT 25`,
          [titolo, category, wanted],
        );
        const best = rows.length ? rows[0].tier : null;
        rows = rows.filter((r) => r.tier === best);
      }

      if (rows.length === 0) {
        return asText(
          `Nessuna voce trovata per "${titolo ?? slug}". Usa cerca_nel_manuale per trovare il nome esatto ` +
            "oppure elenca_categoria per sfogliare.",
        );
      }
      const sources = await sourcesBySlug(rows.map((r) => r.slug));
      if (rows.length > 1) {
        const list = rows
          .map((r) => `- ${r.title} [${r.category}] slug: ${r.slug} — ${sourceText(sources.get(r.slug))}`)
          .join("\n");
        return asText(
          `Più voci corrispondono a "${titolo ?? slug}". Richiamami con lo slug o la categoria:\n${list}`,
        );
      }
      const r = rows[0];
      const start = offset ?? 0;
      const MAX = 24000;
      const body = r.content.slice(start, start + MAX);
      const more = r.content.length > start + MAX
        ? `\n\n[...testo continua: richiama leggi_voce con offset=${start + MAX}]`
        : "";
      return asText(
        `# ${r.title}\nMANUALE: ${sourceText(sources.get(r.slug))}\ncategoria: ${r.category} | slug: ${r.slug}\n\n${body}${more}`,
      );
    },
  );

  server.registerTool(
    "elenca_categoria",
    {
      title: "Elenca una categoria",
      description:
        "Elenca le voci di una categoria (titolo + slug), con filtro opzionale sul titolo/tag. " +
        `Categorie: ${categoryList}. Utile per sfogliare (es. tutti i talenti, i mostri con 'drago' nel nome).`,
      inputSchema: {
        categoria: z.string().describe(`Una tra: ${categoryList} (anche in italiano)`),
        filtro: z.string().optional().describe("Testo da cercare nel titolo o nei tag"),
        limite: z.number().int().min(1).max(300).optional().describe("Max voci (default 100)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ categoria, filtro, limite }) => {
      const category = resolveCategory(categoria);
      if (!category) return asError(`Categoria '${categoria}' sconosciuta. Valide: ${categoryList}`);
      const max = limite ?? 100;
      const rows = await readQuery(
        `SELECT title, slug,
                concat_ws(', ', "metadataJson"->>'rarita', "metadataJson"->>'scuola',
                          "metadataJson"->>'tipo_creatura', "metadataJson"->>'classe',
                          "metadataJson"->>'tipo_talento') AS hint,
                count(*) OVER () AS total
         FROM "Entry"
         WHERE category::text = $1
           AND ($2::text IS NULL OR title ILIKE '%' || $2 || '%' OR array_to_string(tags, ' ') ILIKE '%' || $2 || '%')
         ORDER BY title LIMIT $3`,
        [category, filtro ?? null, max],
      );
      if (rows.length === 0) return asText(`Nessuna voce in ${category}${filtro ? ` con "${filtro}"` : ""}.`);
      const total = Number(rows[0].total);
      // Manuale di ogni voce: se è uno solo lo scrivo in testa, altrimenti accanto a ciascuna voce.
      const sources = await sourcesBySlug(rows.map((r) => r.slug));
      const names = new Set(rows.map((r) => sourceText(sources.get(r.slug))));
      const perRow = names.size > 1;
      const lines = rows.map(
        (r) =>
          `- ${r.title}${r.hint ? ` (${r.hint})` : ""} — slug: ${r.slug}` +
          (perRow ? ` — ${sourceText(sources.get(r.slug))}` : ""),
      );
      const header = perRow ? "" : `MANUALE: ${[...names][0]}\n`;
      const note = total > rows.length ? `\n\n[mostrate ${rows.length} di ${total}: restringi con 'filtro' o alza 'limite']` : "";
      return asText(`${category} — ${CATEGORIES[category]}: ${total} voci\n${header}\n${lines.join("\n")}${note}`);
    },
  );

  server.registerTool(
    "info_manuale",
    {
      title: "Contenuto dei manuali caricati",
      description:
        "Mostra, per ciascun manuale caricato, che tipo di contenuto è stato importato (classi, specie, talenti, " +
        "incantesimi, mostri, ...): con i nomi quando sono pochi, solo il conteggio per le categorie grandi. " +
        "Usalo per capire cosa c'è (e cosa manca) prima di rispondere.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const rows = await readQuery(
        `SELECT fonte, categoria, count(*)::int AS n,
                CASE WHEN count(*) <= CASE WHEN categoria IN ('SPECIES','BACKGROUNDS','SUBCLASSES','FEATS') THEN 35 ELSE 15 END
                          OR fonte = '__homerule' THEN array_agg(title ORDER BY title) END AS titoli
         FROM (
           SELECT CASE
                    WHEN coalesce("metadataJson"->>'fonte', '') <> '' THEN "metadataJson"->>'fonte'
                    WHEN slug LIKE 'homerules-%' THEN '__homerule'
                    ELSE '__servizio'
                  END AS fonte,
                  CASE WHEN category = 'CLASSES' AND "metadataJson"->>'categoria' = 'lista_incantesimi'
                       THEN 'SPELL_LISTS' ELSE category::text END AS categoria,
                  title
           FROM "Entry"
         ) t
         GROUP BY fonte, categoria`,
      );

      // Unifica i nomi alternativi dello stesso libro.
      const canonical = canonicalFonte;
      const books = new Map(); // fonte -> Map(categoria -> {n, titoli})
      for (const r of rows) {
        const name = canonical(r.fonte);
        const cats = books.get(name) ?? new Map();
        const cur = cats.get(r.categoria) ?? { n: 0, titoli: [] };
        cur.n += r.n;
        cur.titoli = cur.titoli && r.titoli ? [...cur.titoli, ...r.titoli] : null; // lista solo se completa
        cats.set(r.categoria, cur);
        books.set(name, cats);
      }

      const stripType = (t) =>
        t.replace(/^(Incantesimo|Talento|Glossario|Regola|Creatura|Oggetto magico|Homerule|Specie|Sottoclasse|Origini)( Mordenkainen)?( \([^)]*\))?:\s+/i, "");
      const sections = [...books.entries()]
        .filter(([name]) => name !== "__servizio")
        .sort((a, b) => {
          const total = (m) => [...m.values()].reduce((s, c) => s + c.n, 0);
          if (a[0] === "__homerule") return 1;
          if (b[0] === "__homerule") return -1;
          return total(b[1]) - total(a[1]);
        })
        .map(([name, cats]) => {
          const heading =
            name === "__homerule"
              ? "Homerule di campagna (regole della campagna: prevalgono sul manuale)"
              : name + (PARTIAL[name] ? ` — ${PARTIAL[name]}` : "");
          const lines = CATEGORY_ORDER.filter((c) => cats.has(c)).map((c) => {
            const { n, titoli } = cats.get(c);
            const label = CATEGORY_LABELS[c];
            return titoli && titoli.length === n
              ? `- ${label} (${n}): ${titoli.map(stripType).join(", ")}`
              : `- ${label}: ${n} voci`;
          });
          return `## ${heading}\n${lines.join("\n")}`;
        });

      return asText(
        "MANUALI CARICATI — edizione 2024 in italiano (i libri senza edizione italiana sono tradotti/adattati).\n" +
          "I numeri contano voci (un file = una voce): equipaggiamento e regole sono sezioni, non singoli oggetti.\n\n" +
          sections.join("\n\n") +
          "\n\nNon caricati: Calderone di Tasha, Guida di Xanathar, Tesoro dei draghi di Fizban, Van Richten a Ravenloft, " +
          "Explorer's Guide to Wildemount e i manuali della 5e 2014: se la risposta dipende da questi libri, dillo " +
          "invece di inventarla. Le homerule sono in RULES (slug 'homerules-…') e prevalgono sul manuale.",
      );
    },
  );

  return server;
}
