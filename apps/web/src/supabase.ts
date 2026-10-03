import { createClient } from '@supabase/supabase-js';

// Supabase se usa solo para el login. Los datos se leen siempre a través del Worker.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
