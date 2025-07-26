import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

serve(async (_req) => {
  try {
    // Create an admin client to bypass RLS
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get the timestamp for one minute ago
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();

    // Delete all records from the waiting pool older than one minute
    const { error } = await supabaseAdmin
      .from('waiting_pool')
      .delete()
      .lt('created_at', oneMinuteAgo);

    if (error) {
      throw error;
    }

    return new Response('Cleaned up stale users from the waiting pool.', {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err) {
    return new Response(String(err?.message ?? err), { status: 500 });
  }
});