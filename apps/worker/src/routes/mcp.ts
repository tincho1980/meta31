import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { createMcpServer } from '../mcp/server.js';

/**
 * Remote MCP server (RF-35, RNF-08), Streamable HTTP without sessions: every request gets its own
 * server and transport, with the request's database and user (the same auth as the PWA).
 */
export const mcp = new Hono<AppEnv>().all('/', async (c) => {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = createMcpServer(c.var.db, c.var.user);
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});
