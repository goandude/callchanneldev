import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import 'https://deno.land/std@0.208.0/dotenv/load.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY from .env file.");
  Deno.exit(1);
}

// ✅ MODIFIED SECTION: This function now listens for database changes
const waitForMatch = (client, userId) => {
  return new Promise((resolve, reject) => {
    const channel = client.channel(`testing-notifications-for-${userId}`);
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout: User ${userId} never received a database notification.`));
      client.removeChannel(channel);
    }, 15000);

    channel
      .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}` // Only listen for our own notifications
        },
        (payload) => {
          console.log(`✅ User ${userId} received DB notification!`, payload.new);
          clearTimeout(timeout);
          resolve(payload.new);
          client.removeChannel(channel);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`- 2.2 User ${userId} is subscribed and listening for DB changes on the 'notifications' table.`);
        }
      });
  });
};

async function runMatchmakingTest() {
  console.log("--- STARTING MATCHMAKING TEST (DATABASE METHOD) ---");
  const client1 = createClient(supabaseUrl, supabaseAnonKey);
  const client2 = createClient(supabaseUrl, supabaseAnonKey);

  const { data: { user: user1 } } = await client1.auth.signInAnonymously();
  const { data: { user: user2 } } = await client2.auth.signInAnonymously();

  if (!user1 || !user2) throw new Error("Failed to sign in anonymous users.");
  console.log(`- User 1 (Alice) signed in: ${user1.id}`);
  console.log(`- User 2 (Bob) signed in: ${user2.id}`);

  const user1Promise = waitForMatch(client1, user1.id);
  const user2Promise = waitForMatch(client2, user2.id);

  console.log("\n--- SIMULATING SEARCH ---");
  console.log("1. Alice is calling the 'find-partner' function...");
  const { data: aliceResponse } = await client1.functions.invoke('find-partner', {
    body: { preferences: { ageRange: [18, 99], sex: 'any' } },
  });
  console.log("-> Server response for Alice:", aliceResponse);
  
  console.log("\n2. Bob is calling the 'find-partner' function...");
  const { data: bobResponse } = await client2.functions.invoke('find-partner', {
    body: { preferences: { ageRange: [18, 99], sex: 'any' } },
  });
  console.log("-> Server response for Bob:", bobResponse);

  try {
    await Promise.all([user1Promise, user2Promise]);
    console.log("\n--- ✅ SUCCESS: Both users received the match notification via database change! ---");
  } catch (e) {
    console.error("\n--- ❌ TEST FAILED ---");
    console.error(e.message);
  } finally {
    await client1.auth.signOut();
    await client2.auth.signOut();
    Deno.exit();
  }
}

runMatchmakingTest();