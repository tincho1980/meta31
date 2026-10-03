import type { AppUser, Db } from '@meta31/db';

/** Worker bindings and variables (wrangler.jsonc + secrets). */
export type Bindings = {
  HYPERDRIVE: { connectionString: string };
  SUPABASE_URL: string;
  ALLOWED_ORIGINS: string;
  /** Only if Supabase signs with the legacy HS256 secret. */
  SUPABASE_JWT_SECRET?: string;
};

export type Variables = {
  db: Db;
  user: AppUser;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
