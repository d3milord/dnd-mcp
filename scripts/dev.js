// Server locale per provare l'endpoint: node scripts/dev.js  ->  http://localhost:8787/mcp
// Legge DATABASE_URL da ../web/.env se non è già nell'ambiente.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import handler from "../api/mcp.js";

const here = dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  for (const file of [join(here, "..", ".env"), join(here, "..", "..", "web", ".env")]) {
    try {
      const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
      if (line) {
        process.env.DATABASE_URL = line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
        break;
      }
    } catch {
      /* file assente: provo il prossimo */
    }
  }
}

const port = Number(process.env.PORT ?? 8787);

createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path !== "/mcp" && path !== "/api/mcp") {
    res.statusCode = 404;
    return res.end("Usa /mcp");
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    req.body = raw ? JSON.parse(raw) : undefined;
  } catch {
    req.body = undefined;
  }
  await handler(req, res);
}).listen(port, () => console.log(`MCP locale su http://localhost:${port}/mcp`));
