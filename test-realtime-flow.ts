import { createClient, SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2';
import 'https://deno.land/std@0.208.0/dotenv/load.ts';

// --- Configuration ---
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TEST_TIMEOUT = 15000; // 15 seconds

// --- Validation ---
if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
  console.error("❌ Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY from .env file.");
  Deno.exit(1);
}

const adminClient = createClient(supabaseUrl, serviceRoleKey);

/**
 * Cleans up the database from any lingering test data.
 */
async function cleanup(userIds: string[]) {
    console.log('\n--- 🧹 Pre-test Cleanup ---');
    if (userIds.length > 0) {
        const { error: waitingPoolError } = await adminClient.from('waiting_pool').delete().in('user_id', userIds);
        if (waitingPoolError) console.error('Error cleaning waiting_pool:', waitingPoolError.message);
        else console.log('- Cleaned waiting_pool for test users.');

        const { error: notificationsError } = await adminClient.from('notifications').delete().in('user_id', userIds);
        if (notificationsError) console.error('Error cleaning notifications:', notificationsError.message);
        else console.log('- Cleaned notifications for test users.');
    }
    console.log('--- Cleanup Complete ---\n');
}


/**
 * Represents a simulated user who can search for a partner and listen for a match.
 */
class SimulatedUser {
    client: SupabaseClient;
    user: User | null = null;
    name: string;
    matchPromise: Promise<any>;
    private resolveMatch: (value: any) => void = () => {};
    private rejectMatch: (reason?: any) => void = () => {};
    private channel: any = null;

    constructor(name: string) {
        this.name = name;
        this.client = createClient(supabaseUrl, supabaseAnonKey);
        this.matchPromise = new Promise((resolve, reject) => {
            this.resolveMatch = resolve;
            this.rejectMatch = reject;
        });
    }

    async initialize() {
        const { data, error } = await this.client.auth.signInAnonymously();
        if (error || !data.user) {
            throw new Error(`User ${this.name} failed to sign in: ${error?.message}`);
        }
        this.user = data.user;
        console.log(`- User '${this.name}' signed in with ID: ${this.user.id}`);
        this._listenForMatch();
    }

    private _listenForMatch() {
        if (!this.user) return;
        
        const timeout = setTimeout(() => {
            this.rejectMatch(new Error(`Timeout: User ${this.name} never received a match notification.`));
            this.client.removeChannel(this.channel);
        }, TEST_TIMEOUT);

        this.channel = this.client.channel(`test-match-for-${this.user.id}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${this.user.id}`
                },
                (payload) => {
                    console.log(`[${this.name}] ✅ Received match notification!`, payload.new);
                    clearTimeout(timeout);
                    this.resolveMatch(payload.new);
                    this.client.removeChannel(this.channel);
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log(`[${this.name}] Subscribed to notifications channel.`);
                } else if (status === 'CHANNEL_ERROR') {
                    this.rejectMatch(new Error(`[${this.name}] Failed to subscribe to channel.`));
                }
            });
    }

    async findPartner() {
        console.log(`\n[${this.name}] 📞 Calling 'find-partner' function...`);
        const { data, error } = await this.client.functions.invoke('find-partner', {
            body: { preferences: { sex: 'any' } },
        });

        if (error) {
            throw new Error(`[${this.name}] Edge function call failed: ${error.message}`);
        }

        console.log(`[${this.name}] 💬 Server response:`, data);
        return data;
    }

    async signOut() {
        await this.client.auth.signOut();
    }
}

/**
 * Main test runner function.
 */
async function runRealtimeTest() {
    console.log("--- 🚀 STARTING REALTIME MATCHMAKING TEST ---");
    
    const alice = new SimulatedUser('Alice');
    const bob = new SimulatedUser('Bob');

    try {
        await Promise.all([alice.initialize(), bob.initialize()]);
        await cleanup([alice.user!.id, bob.user!.id]);

        const aliceResponse = await alice.findPartner();
        if (aliceResponse.status !== 'waiting') throw new Error(`Expected Alice to be 'waiting', but got '${aliceResponse.status}'`);
        console.log("[Alice] ✅ Correctly placed in waiting pool.");

        const bobResponse = await bob.findPartner();
        if (bobResponse.status !== 'matched') throw new Error(`Expected Bob to be 'matched', but got '${bobResponse.status}'`);
        console.log(`[Bob] ✅ Correctly matched with partner: ${bobResponse.partnerId}`);
        if (bobResponse.partnerId !== alice.user!.id) throw new Error(`Bob was matched with the wrong user! Expected ${alice.user!.id}, got ${bobResponse.partnerId}`);

        console.log("\n--- ⏳ Waiting for Realtime notifications ---");
        // The user who was waiting (Alice) gets a realtime notification.
        // The user who initiated the match (Bob) gets the details in the function response, not a notification.
        const aliceNotification = await alice.matchPromise;

        // Alice's notification should contain Bob's ID
        if (aliceNotification.payload.partnerId !== bob.user!.id) throw new Error(`Alice's notification has wrong partnerId. Expected ${bob.user!.id}, got ${aliceNotification.payload.partnerId}`);
        
        // The roomId should be the same for both users.
        if (aliceNotification.payload.roomId !== bobResponse.roomId) throw new Error(`Room ID mismatch! Alice got ${aliceNotification.payload.roomId}, Bob got ${bobResponse.roomId}`);
        
        console.log("\n--- ✅ SUCCESS: Alice received correct match notification and Bob received correct function response! ---");

    } catch (e) {
        console.error("\n--- ❌ TEST FAILED ---");
        console.error(e.message);
    } finally {
        console.log("\n--- 🧹 Tearing down test ---");
        await Promise.all([alice.signOut(), bob.signOut()]).catch(() => {});
        Deno.exit();
    }
}

runRealtimeTest();