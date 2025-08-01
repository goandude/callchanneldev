import { useState, useRef, useEffect, FC } from 'react';
import Head from 'next/head';
import { supabase } from '../lib/supabaseClient';
import { Session, User } from '@supabase/supabase-js';
import { Phone, Video, VideoOff, Mic, MicOff, SkipForward, Users, CircleDot } from 'lucide-react';
import { iceServers } from '../lib/iceServers';
import ProfileSetupModal from '../components/ProfileSetupModal';
import MatchingOptionsBar from '../components/MatchingOptionsBar';
import ConnectionPortal from '../components/ConnectionPortal';
import OnlineCounter from '../components/OnlineCounter'; // ✅ NEW: Import the counter

// --- Type Definitions ---
interface MatchingPreferences {
  sex: 'male' | 'female' | 'any';
  city: string;
  country: string;
   interests: string[];
}
type AppState = 'IDLE' | 'AWAITING_MEDIA' | 'SEARCHING' | 'CONNECTING' | 'CONNECTED' | 'ERROR';
interface Profile { id: string; is_profile_complete: boolean; nickname: string; [key: string]: any; }

// --- Chat Controller Class ---
class ChatController {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private matchChannel: any | null = null; // Using 'any' to avoid RealtimeChannel type issues
  private signalingChannel: any | null = null;
  private queuedCandidates: RTCIceCandidateInit[] = [];
  private userId: string;
  private partnerId: string | null = null;
  private roomId: string | null = null;
  private isOfferCreator: boolean = false;
  private onStateChange: (state: AppState) => void;
  private onLocalStream: (stream: MediaStream | null) => void;
  private onRemoteStream: (stream: MediaStream | null) => void;
  private connectionTimeout: NodeJS.Timeout | null = null;
  private onPartnerDisconnect: () => void;
  private onPartnerProfile: (profile: Profile | null) => void;

  constructor(
  userId: string, 
  onStateChange: (state: AppState) => void, 
  onLocalStream: (stream: MediaStream | null) => void, 
  onRemoteStream: (stream: MediaStream | null) => void, 
  onPartnerDisconnect: () => void,
  onPartnerProfile: (profile: Profile | null) => void
) {
  this.userId = userId;
  this.onStateChange = onStateChange;
  this.onLocalStream = onLocalStream;
  this.onRemoteStream = onRemoteStream;
  this.onPartnerDisconnect = onPartnerDisconnect;
  this.onPartnerProfile = onPartnerProfile;
}


  private setState = (state: AppState) => { this.onStateChange(state); }

  public initialize = async (): Promise<void> => {
  this.setState('AWAITING_MEDIA');
  try {
    // ADDED: Error handling for the delete operation
    console.log("Attempting to clean up old notifications on startup...");
    await supabase.functions.invoke('cleanup-notifications', {
      body: { userId: this.userId }
    });
    console.log("✅ Successfully cleaned up old notifications on startup.");

    await supabase.from('waiting_pool').delete().eq('user_id', this.userId);
    console.log("✅ Successfully cleaned up old waiting pool entries on startup.");
    if (!this.localStream) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      this.localStream = stream;
      this.onLocalStream(stream);
    }
    this.setState('IDLE');
  } catch (err) {
    this.setState('ERROR');
  }
}

  public startChat = async (preferences: MatchingPreferences): Promise<void> => {
    this.setState('SEARCHING');
    this.listenForMatch(); // Start listening for a match immediately

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) {
        throw new Error("Authentication error: No active session found.");
      }

      const { data, error } = await supabase.functions.invoke('find-partner', { body: { preferences } });
      if (error) throw error;

      if (data.status === 'matched') {
        // This user initiated the match. They are the "offer creator".
        this.isOfferCreator = true;
        this.stopListeningForMatch(); // We found a match, no need to listen anymore.

        const { roomId, partnerId } = data;

        // Fetch profile in the background, don't block connection setup
        supabase
          .from('profiles')
          .select('*')
          .eq('id', partnerId)
          .single()
          .then(({ data: partnerProfile, error: profileError }) => {
            if (profileError) console.error("Error fetching partner profile:", profileError);
            this.onPartnerProfile(partnerProfile);
          });

        await this.joinRoom(roomId, partnerId);
      }
      // If status is 'waiting', we just keep listening. The realtime event will handle the rest.
    } catch (err) {
      console.error("Error in startChat:", err);
      this.setState('ERROR');
      this.stopListeningForMatch(); // Stop listening on error
    }
  }

  private listenForMatch = () => {
    this.stopListeningForMatch(); // Ensure no old listeners are running
    const channel = supabase.channel(`match-for-${this.userId}`);

    this.matchChannel = channel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${this.userId}`,
        },
        async (payload) => {
          console.log('✅ Match found via Realtime!', payload.new);
          this.stopListeningForMatch();

          // Fetch partner's profile in the background, don't block connection setup
          supabase
            .from('profiles')
            .select('*')
            .eq('id', payload.new.payload.partnerId)
            .single()
            .then(({ data: partnerProfile, error: profileError }) => {
              if (profileError) console.error("Error fetching partner profile:", profileError);
              this.onPartnerProfile(partnerProfile);
            });

          const { roomId, partnerId } = payload.new.payload;

          await supabase.from('notifications').delete().eq('id', payload.new.id);

          await this.joinRoom(roomId, partnerId);
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[Realtime] Subscribed to match notifications for user ${this.userId}`);
        }
        if (status === 'CHANNEL_ERROR') {
          console.error(`[Realtime] Failed to subscribe to match notifications`, err);
          this.setState('ERROR');
        }
      });
  }

  private stopListeningForMatch = () => {
    if (this.matchChannel) {
      supabase.removeChannel(this.matchChannel);
      this.matchChannel = null;
    }
  }

  private joinRoom = async (roomId: string, partnerId: string): Promise<void> => {
    console.log("In Join Room");
    this.setState('CONNECTING');
    this.connectionTimeout = setTimeout(() => {
      if (this.pc?.connectionState !== 'connected') {
        console.warn("Connection timed out. Resetting and finding a new partner.");
        this.onPartnerDisconnect();
      }
    }, 6000);

    this.roomId = roomId;
    this.partnerId = partnerId;
    this.createPeerConnection();
    this.listenForSignalingMessages();
    // The offer will now be created when the 'presence' event is received
    // in listenForSignalingMessages, indicating the other user is ready.
  }

  private listenForSignalingMessages = () => {
    this.stopListeningForSignaling();
    if (!this.roomId) return;

    const channel = supabase.channel(`signaling-for-${this.roomId}`);
    this.signalingChannel = channel.on('presence', { event: 'join' }, ({ newPresences }) => {
        // This event tells us another user has subscribed to this channel.
        // If we are the offer creator, and the new user is our partner, we can now create the offer.
        const partner = newPresences.find(p => p.user_id === this.partnerId);
        if (partner && this.isOfferCreator) {
            console.log('Partner has joined the signaling channel. Creating offer.');
            this.createOffer();
        }
    })
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'signaling',
          filter: `recipient_id=eq.${this.userId}`,
        },
        async (payload) => {
          console.log('[Realtime] Received signaling message:', payload.new.payload.type);

          const msg = payload.new;
          await supabase.from('signaling').delete().eq('id', msg.id);

          if (!this.pc) return;
          const { type, sdp, candidate } = msg.payload;
          try {
            if (type === 'offer') {
              await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
              await this.processIceCandidates();
              const answer = await this.pc.createAnswer();
              await this.pc.setLocalDescription(answer);
              await this.sendSignalingMessage({ type: 'answer', sdp: this.pc.localDescription?.sdp });
            } else if (type === 'answer') {
              if (this.pc.signalingState !== 'stable') {
                await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
                await this.processIceCandidates();
              }
            } else if (type === 'candidate') {
              if (this.pc.remoteDescription) {
                await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
              } else {
                console.log('Queuing ICE candidate...');
                this.queuedCandidates.push(candidate);
              }
            }
          }
          catch (e) { console.error("Signaling error:", e) }
        }
      )
      
      .subscribe(async (status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[Realtime] Subscribed to signaling for room ${this.roomId}`);
         const trackStatus = await this.signalingChannel.track({ user_id: this.userId });
         if (trackStatus !== 'ok') {
            console.error('Failed to track presence on signaling channel');
            this.setState('ERROR');
         }
        }
        if (status === 'CHANNEL_ERROR') {
          console.error(`[Realtime] Failed to subscribe to signaling`, err);
          this.setState('ERROR');
        }
      });
  }

  
  private async processIceCandidates(): Promise<void> {
    try {
      console.log(`Attempting to add  ${this.queuedCandidates.length} queued ICE candidates...`);
      while (this.queuedCandidates.length > 0 && this.pc?.remoteDescription) {
        const candidate = this.queuedCandidates.shift()!;
        console.log('Trying to add a queued ICE candidate:', candidate);
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (e) {
      console.error("Error processing ICE candidates:", e);
    }
  }

  private stopListeningForSignaling = () => {
    if (this.signalingChannel) {
      supabase.removeChannel(this.signalingChannel);
      this.signalingChannel = null;
    }
  }

  private sendSignalingMessage = async (payload: any) => {
    if (this.partnerId && this.roomId) {
      await supabase.from('signaling').insert({ room_id: this.roomId, recipient_id: this.partnerId, payload });
    }
  }

  private createPeerConnection = (): void => {
    if (this.pc) return;
    this.pc = new RTCPeerConnection({ iceServers });
    this.pc.onicecandidate = async (e) => { if (e.candidate) await this.sendSignalingMessage({ type: 'candidate', candidate: e.candidate }); };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState;
      if (state === 'connected') {
        if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
        this.setState('CONNECTED');
      } else if (state === 'disconnected' || state === 'failed') {
        this.onPartnerDisconnect();
      }
    };

    this.localStream?.getTracks().forEach(track => this.pc!.addTrack(track, this.localStream!));
    this.pc.ontrack = (e) => this.onRemoteStream(e.streams[0]);
  }

  private createOffer = async (): Promise<void> => {
    if (!this.pc) this.createPeerConnection();
    const offer = await this.pc!.createOffer();
    await this.pc!.setLocalDescription(offer);
    await this.sendSignalingMessage({ type: 'offer', sdp: this.pc!.localDescription?.sdp });
  }

  private cleanup = async (): Promise<void> => {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }

    this.stopListeningForMatch();
    this.stopListeningForSignaling();

    this.pc?.close();
    this.pc = null;
    this.isOfferCreator = false;
    this.roomId = null;
    this.partnerId = null;

    this.queuedCandidates = [];

    await supabase.from('signaling').delete().eq('recipient_id', this.userId);
  }

  public hangUp = async (reconnect: boolean = false): Promise<void> => {
    this.onRemoteStream(null);
    this.onPartnerProfile(null);
    await this.cleanup();
    await supabase.functions.invoke('cleanup-notifications', {
      body: { userId: this.userId }
    });

    if (reconnect) {
      this.startChat({ sex: 'any', city: '', country: '', interests: [] });
    } else {
      this.setState('IDLE');
    }
  }

  public toggleMute = (): void => { this.localStream?.getAudioTracks().forEach(t => t.enabled = !t.enabled); }
  public toggleVideo = (): void => { this.localStream?.getVideoTracks().forEach(t => t.enabled = !t.enabled); }
}

// --- Profile Overlay Component ---
const ProfileOverlay: FC<{ profile: Profile | null }> = ({ profile }) => {
  if (!profile) return null;

  const { nickname, sex, city, country, interests } = profile;

  return (
    <div className="absolute bottom-20 left-4 bg-black/50 text-white p-3 rounded-lg text-sm z-20 max-w-xs pointer-events-none">
      <p className="font-bold text-base">{nickname || 'Anonymous'}</p>
      {sex && city && country && (
        <p className="text-white/80">{`${sex}, from ${city}, ${country}`}</p>
      )}
      {interests && interests.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {interests.map((interest: string) => (
            <span key={interest} className="bg-gray-700 px-2 py-1 rounded-full text-xs">
              {interest}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

// --- Main React Component ---
const Home: FC = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [partnerProfile, setPartnerProfile] = useState<Profile | null>(null);
  const [appState, setAppState] = useState<AppState>('IDLE');
  const [matchingPrefs, setMatchingPrefs] = useState<MatchingPreferences>({ sex: 'any', city: '', country: '',  interests: [] });
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const controllerRef = useRef<ChatController | null>(null);
  const [onlineCount, setOnlineCount] = useState(0); // ✅ NEW: State for online count
  const [isAutoRequeuing, setIsAutoRequeuing] = useState(false);
  const isAutoRequeuingRef = useRef(isAutoRequeuing);
  isAutoRequeuingRef.current = isAutoRequeuing;
  
  useEffect(() => {
    const handleAuthAndProfile = async () => {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      let activeSession = currentSession;
      if (!activeSession) {
        const { data: { session: newSession } } = await supabase.auth.signInAnonymously();
        activeSession = newSession;
      }
      setSession(activeSession);
      if (activeSession) {
        const { data: profileData } = await supabase.from('profiles').select('*').eq('id', activeSession.user.id).single();
        setProfile(profileData);
      }
    };
    handleAuthAndProfile();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session));
    return () => subscription?.unsubscribe();
  }, []);

  useEffect(() => {
    if (session && !controllerRef.current) {

      const handlePartnerDisconnect = () => {
        if (isAutoRequeuingRef.current) {
          controllerRef.current?.hangUp(true); // Automatically find new partner
        } else {
          controllerRef.current?.hangUp(false); // Go back to the home screen
        }
      };
      const chatController = new ChatController(
        session.user.id,
        setAppState,
        setLocalStream,
        setRemoteStream,
        handlePartnerDisconnect,
        setPartnerProfile
      );
      controllerRef.current = chatController;
      chatController.initialize();
    }
  }, [session]);
  useEffect(() => {
    const channel = supabase.channel('global-presence-counter');
    channel
      .on('presence', { event: 'sync' }, () => {
        const presenceState = channel.presenceState();
        const count = Object.keys(presenceState).length;
        setOnlineCount(count);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });
    return () => {
      supabase.removeChannel(channel);
    }
  }, []);
  useEffect(() => { if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream; }, [localStream]);
  useEffect(() => { if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream; }, [remoteStream]);
  const handleStartSearch = () => {
    setIsAutoRequeuing(true);
    controllerRef.current?.startChat(matchingPrefs);
  };
  const handleEndCall = () => {
    setIsAutoRequeuing(false);
    controllerRef.current?.hangUp(false);
  };

  const handleToggleMute = () => { controllerRef.current?.toggleMute(); setIsMuted(p => !p); }
  const handleToggleVideo = () => { controllerRef.current?.toggleVideo(); setIsVideoOff(p => !p); }
  const getStatusText = (): string => { switch (appState) { case 'IDLE': return 'Ready to Chat'; case 'AWAITING_MEDIA': return 'Permissions...'; case 'SEARCHING': return 'Searching...'; case 'CONNECTING': return 'Connecting...'; case 'CONNECTED': return 'Connected'; case 'ERROR': return 'Error'; default: return 'Loading...'; } };

  if (!session || !profile) {
    return <div className="h-screen w-screen flex items-center justify-center bg-gray-900 text-white">Loading...</div>;
  }
  
  return (
  <>
    <Head><title>Video Chat</title></Head>
    {profile && !profile.is_profile_complete && (
      <ProfileSetupModal user={session.user} profile={profile} onComplete={() => window.location.reload()} />
    )}
    <main className="h-screen w-screen bg-black flex font-sans">
      <OnlineCounter onlineCount={onlineCount} />
      <div className="flex-1 flex flex-col relative">
        <header className="absolute top-0 left-0 right-0 z-30 h-[72px] flex items-center px-6 justify-between bg-gradient-to-b from-black/50 to-transparent text-white">
          <h1 className="text-xl font-semibold">Chat App</h1>
        </header>

        <div className="absolute inset-0 z-0">
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-contain bg-black" />
          {/* Display partner's profile info */}
          {remoteStream && <ProfileOverlay profile={partnerProfile} />}
        </div>

        {/* --- MODIFICATION START --- */}

        {/* 1. Show the full-screen animation when searching or connecting */}
        {(appState === 'SEARCHING' || appState === 'CONNECTING') && (
          <ConnectionPortal statusText={getStatusText()} />
        )}

        {/* 2. Show the idle overlay only when idle */}
        {appState === 'IDLE' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-black/40 text-white p-4 text-center z-10 pointer-events-none">
            <h2 className="text-3xl font-semibold drop-shadow-lg">{getStatusText()}</h2>
            <MatchingOptionsBar prefs={matchingPrefs} setPrefs={setMatchingPrefs} disabled={false} />
            <button 
              onClick={() => controllerRef.current?.startChat(matchingPrefs)} 
              className="bg-blue-500 font-semibold rounded-lg px-8 py-3 transition-transform hover:scale-105 pointer-events-auto"
            >
              Find Partner
            </button>
          </div>
        )}

        {/* --- MODIFICATION END --- */}

        <div className="absolute top-4 right-4 w-60 rounded-lg overflow-hidden shadow-lg z-20 aspect-video">
          <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover bg-black/50" />
          {/* Display local user's profile info */}
          <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent pointer-events-none">
              <p className="text-white text-sm font-semibold truncate">{profile?.nickname || 'You'}</p>
          </div>
          {isVideoOff && <div className="absolute inset-0 bg-black/70 flex items-center justify-center text-white/80">Video Off</div>}
        </div>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center justify-center space-x-4 bg-black/40 backdrop-blur-md p-3 rounded-full z-30">
            <button 
    onClick={handleToggleMute} 
    className={`p-3 rounded-full text-white ${isMuted ? 'bg-red-500' : 'bg-gray-700'}`}
  >
    {isMuted ? <MicOff /> : <Mic />}
  </button>
  
  <button 
    onClick={handleToggleVideo} 
    className={`p-3 rounded-full text-white ${isVideoOff ? 'bg-red-500' : 'bg-gray-700'}`}
  >
    {isVideoOff ? <VideoOff /> : <Video />}
  </button>

  {/* --- MODIFICATION END --- */}

  <button onClick={() => controllerRef.current?.hangUp(true)} className="p-3 rounded-full bg-gray-500 text-white">
    <SkipForward />
  </button>
  <button onClick={() => controllerRef.current?.hangUp(false)} className="p-3 rounded-full bg-red-600 text-white">
    <Phone />
  </button>
          </div>  
      </div>
    </main>
  </>
);
};

export default Home;