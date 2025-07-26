import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: corsHeaders }); }
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Authentication failed.');

    // ✅ FIX: Call the correct, simple RPC function
    const { data: matchedUsers, error: rpcError } = await supabase
      .rpc('match_partner', { requesting_user_id: user.id });

    if (rpcError) throw rpcError;

    const waitingPartner = matchedUsers[0];

    if (waitingPartner) {
      const partnerId = waitingPartner.matched_user_id;
      const roomId = `room_${crypto.randomUUID()}`;
      
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
      const notifications = [
        { user_id: user.id, payload: { roomId, partnerId: partnerId } },
        { user_id: partnerId, payload: { roomId, partnerId: user.id } }
      ];
      await supabaseAdmin.from('notifications').insert(notifications);
      
      return new Response(JSON.stringify({ status: 'matched', roomId, partnerId: partnerId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await supabase.from('waiting_pool').upsert({ user_id: user.id });
    return new Response(JSON.stringify({ status: 'waiting' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error("--- FATAL ERROR ---", error);
    return new Response(JSON.stringify({ error: { message: error.message, code: error.code, details: error.details } }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500
    });
  }
});