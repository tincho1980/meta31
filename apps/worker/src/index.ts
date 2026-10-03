import { createApp } from './app.js';
import { supabaseVerifier } from './middleware/auth.js';
import { withDb } from './middleware/db.js';

export default createApp({ db: withDb, verifier: supabaseVerifier });
