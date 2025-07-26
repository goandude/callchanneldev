import { createClient, SupabaseClient, User as SupabaseUser } from 'https://esm.sh/@supabase/supabase-js@2';
import 'https://deno.land/std@0.208.0/dotenv/load.ts';

// --- Configuration ---
const NUM_USERS = 10;
const JOIN_WINDOW_SECONDS = 10;
const MIN_CHAT_DURATION_SECONDS = 4; // Updated
const MAX_CHAT_DURATION_SECONDS = 8; // Updated

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY from .env file.");
  Deno.exit(1);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- User Simulation Class ---
class SimulatedUser {
  id: number;
  client: SupabaseClient;
  supaUser: SupabaseUser | null = null;
  state: 'IDLE' | 'SEARCHING' | 'CONNECTED' = 'IDLE';

  constructor(id: number) {
    this.id = id;
    this.client = createClient(supabaseUrl, supabaseAnonKey);
  }

  async initialize() {
    const { data, error } = await this.client.auth.signInAnonymously();
    if (error || !data.user) throw new Error(`User ${this.id} failed to sign in: ${error?.message}`);
    this.supaUser = data.user;
    this.listenForMatch();
  }

  listenForMatch() {
    this.client
      .channel(`sim-notifications-${this.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${this.supaUser!.id}`
      }, (payload) => {
        if (this.state === 'SEARCHING') {
          const { roomId, partnerId } = payload.new.payload;
          this.state = 'CONNECTED';
          console.log(`✅ [User ${this.id}] Connected with User (ID: ...${partnerId.slice(-4)}) in room ${roomId.slice(-12)}`);
          this.client.from('notifications').delete().eq('user_id', this.supaUser!.id).then();
          this.scheduleSkip();
        }
      })
      .subscribe();
  }

  async startSearch() {
    if (this.state !== 'IDLE') return;
    this.state = 'SEARCHING';
    console.log(`- [User ${this.id}] is searching...`);
    const { data, error } = await this.client.functions.invoke('find-partner', {
      body: { preferences: { ageRange: [18, 99], sex: 'any' } },
    });

    if (error) {
      this.state = 'IDLE';
      console.error(`❌ [User ${this.id}] FAILED: Edge Function call failed: ${error.message}`);
      return;
    }

    if (data.status === 'matched') {
      this.state = 'CONNECTED';
      console.log(`✅ [User ${this.id}] Immediately connected with User (ID: ...${data.partnerId.slice(-4)}) in room ${data.roomId.slice(-12)}`);
      this.scheduleSkip();
    }
  }

  // MODIFIED: This method now always schedules a skip.
  async scheduleSkip() {
    const chatDuration = (MIN_CHAT_DURATION_SECONDS + Math.random() * (MAX_CHAT_DURATION_SECONDS - MIN_CHAT_DURATION_SECONDS)) * 1000;
    await sleep(chatDuration);

    if (this.state !== 'CONNECTED') return;
    this.skip();
  }

  // MODIFIED: This method now always reconnects.
  skip() {
    console.log(`- [User ${this.id}] is skipping to find a new partner.`);
    this.state = 'IDLE';
    this.startSearch();
  }
}

// --- Main Simulation ---
async function runSimulation() {
  console.log(`--- STARTING CONTINUOUS SIMULATION WITH ${NUM_USERS} USERS ---`);
  
  const users = Array.from({ length: NUM_USERS }, (_, i) => new SimulatedUser(i + 1));
  await Promise.all(users.map(u => u.initialize()));
  console.log("--- All users initialized. Starting search sequence... ---\n");

  for (const user of users) {
    await sleep(Math.random() * (JOIN_WINDOW_SECONDS * 1000 / NUM_USERS));
    user.startSearch();
  }
}

runSimulation();