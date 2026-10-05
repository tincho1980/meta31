import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env.js';

/** Where the protected resource metadata of the MCP server lives (RFC 9728). */
const metadataUrl = (c: Context<AppEnv>) => `${new URL(c.req.url).origin}/.well-known/oauth-protected-resource/mcp`;

/**
 * Protected resource metadata (RFC 9728) for the MCP server: Supabase Auth is its OAuth 2.1
 * authorization server (decision of 4/10), so claude.ai discovers it, registers itself and logs
 * the user in with Google. The tokens it gets are Supabase tokens, checked by the usual middleware.
 */
export function protectedResourceMetadata(c: Context<AppEnv>) {
  return c.json({
    resource: `${new URL(c.req.url).origin}/mcp`,
    authorization_servers: [`${c.env.SUPABASE_URL}/auth/v1`],
    bearer_methods_supported: ['header'],
    resource_name: 'Meta31',
  });
}

/** A 401 from the MCP server says where to find the authorization server (MCP authorization spec). */
export const mcpChallenge = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  if (c.res.status === 401) {
    const res = new Response(c.res.body, c.res);
    res.headers.set('WWW-Authenticate', `Bearer resource_metadata="${metadataUrl(c)}"`);
    c.res = res;
  }
});
