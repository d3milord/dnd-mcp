// Endpoint MCP (Streamable HTTP, stateless) per Vercel: https://<progetto>.vercel.app/mcp
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "../lib/tools.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

function jsonRpcError(res, status, message) {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

export default async function handler(req, res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  // Token opzionale: se MCP_TOKEN è impostato, serve "Authorization: Bearer <token>" oppure "?token=<token>".
  const expected = process.env.MCP_TOKEN;
  if (expected) {
    const header = req.headers.authorization ?? "";
    const url = new URL(req.url, "http://localhost");
    const given = header.startsWith("Bearer ") ? header.slice(7) : url.searchParams.get("token");
    if (given !== expected) return jsonRpcError(res, 401, "Non autorizzato");
  }

  // Modalità stateless: niente sessioni né stream SSE, solo POST JSON-RPC.
  if (req.method !== "POST") return jsonRpcError(res, 405, "Metodo non consentito: usa POST");

  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Errore MCP:", error);
    if (!res.headersSent) jsonRpcError(res, 500, "Errore interno del server");
  }
}
