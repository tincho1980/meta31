import { createClient } from '@supabase/supabase-js';

// Supabase is used only for login. Data is always read through the Worker.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
