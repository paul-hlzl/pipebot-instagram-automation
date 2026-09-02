import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { getConfig } from "./config.js";

function isValidToken(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) {
    // Compare against itself so the response time doesn't leak the length mismatch.
    crypto.timingSafeEqual(providedBuf, providedBuf);
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

function requireBearerToken(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match?.[1]?.trim();

  if (!token || !isValidToken(token, getConfig().mcpAuthToken)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

/**
 * Builds the Express app exposing the MCP server over Streamable HTTP.
 * `createMcpServer` is invoked once per new session (fresh McpServer instance),
 * matching the pattern recommended by the MCP TypeScript SDK.
 */
export function createHttpApp(createMcpServer: () => McpServer): express.Express {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use(requireBearerToken);

  const transports = new Map<string, StreamableHTTPServerTransport>();

  const mcpPostHandler = async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.header("mcp-session-id");

    try {
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId)!;
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport);
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) {
            transports.delete(sid);
          }
        };

        const server = createMcpServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID provided" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  };

  const mcpSessionHandler = async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.header("mcp-session-id");
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transport.handleRequest(req, res);
  };

  app.post("/mcp", mcpPostHandler);
  app.get("/mcp", mcpSessionHandler);
  app.delete("/mcp", mcpSessionHandler);

  return app;
}
