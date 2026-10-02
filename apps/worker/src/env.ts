import type { AppUser, Db } from '@meta31/db';

/** Bindings y variables del Worker (wrangler.jsonc + secretos). */
export type Bindings = {
  HYPERDRIVE: { connectionString: string };
  SUPABASE_URL: string;
  ALLOWED_ORIGINS: string;
  /** Solo si Supabase firma con el secreto HS256 legado. */
  SUPABASE_JWT_SECRET?: string;
};

export type Variables = {
  db: Db;
  user: AppUser;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
