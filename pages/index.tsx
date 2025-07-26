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
interface Profile { id: string; is_profile_complete: boolean; [key: string]: any; }

// --- Chat Controller Class ---
class ChatController {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private pollingInterval: NodeJS.Timeout | null = null;
  private signalingPollingInterval: NodeJS.Timeout | null = null;
  private userId: string;
  private partnerId: string | null = null;
  private roomId: string | null = null;
  private isOfferCreator: boolean = false;
  private onStateChange: (state: AppState) => void;
  private onLocalStream: (stream: MediaStream | null) => void;
  private onRemoteStream: (stream: MediaStream | null) => void;
  private connectionTimeout: NodeJS.Timeout | null = null;
  private onPartnerDisconnect: () => void; // ✅ NEW: Callback for disconnects

  constructor(
  userId: string, 
  onStateChange: (state: AppState) => void, 
  onLocalStream: (stream: MediaStream | null) => void, 
  onRemoteStream: (stream: MediaStream | null) => void, 
  onPartnerDisconnect: () => void // ✅ The missing parameter
) {
  this.userId = userId;
  this.onStateChange = onStateChange;
  this.onLocalStream = onLocalStream;
  this.onRemoteStream = onRemoteStream;
  this.onPartnerDisconnect = onPartnerDisconnect;
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

 // In the ChatController class
public startChat = async (preferences: MatchingPreferences): Promise<void> => {
  this.setState('SEARCHING');
  try {
    // ✅ ADD THIS CHECK: Ensure we have a valid session before calling the function
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      throw new Error("Authentication error: No active session found.");
    }

    const { data, error } = await supabase.functions.invoke('find-partner', { body: { preferences } });
    if (error) throw error;

    if (data.status === 'waiting') {
      this.pollForMatch();
    } else if (data.status === 'matched') {
      this.stopPolling();
      this.isOfferCreator = true;
      await this.joinRoom(data.roomId, data.partnerId);
    }
  } catch (err) {
    console.error("Error in startChat:", err);
    this.setState('ERROR');
  }
} 

 // In the ChatController class in pages/index.tsx

// pages/index.tsx (in the ChatController class)

private pollForMatch = () => {
  this.stopPolling();
  this.pollingInterval = setInterval(async () => {
    const { data: notifications, error: selectError } = await supabase
      .from('notifications')
      .select('payload')
      .eq('user_id', this.userId);

    if (selectError) {
      console.error("Error polling for match:", selectError);
      return;
    }

    if (notifications && notifications.length > 0) {
      this.stopPolling();
      const notification = notifications[0];
      const { roomId, partnerId } = notification.payload;

      // ADDED: Error handling for the delete operation
      console.log("Match found. Attempting to delete notification...");
      const { error: deleteError } = await supabase
        .from('notifications')
        .delete()
        .eq('user_id', this.userId);

      if (deleteError) {
        console.error("❌ FAILED to delete notification after match:", deleteError);
      } else {
        console.log("✅ Successfully deleted notification after match.");
      }
      
      this.isOfferCreator = false;
      await this.joinRoom(roomId, partnerId);
    }
  }, 1500);
}
  private stopPolling = () => { if (this.pollingInterval) clearInterval(this.pollingInterval); this.pollingInterval = null; }

  private joinRoom = async (roomId: string, partnerId: string): Promise<void> => {
    console.log("In Join Room");
    this.setState('CONNECTING');
    this.connectionTimeout = setTimeout(() => {
    // Only fire if we are still stuck in a connecting state
      if (this.pc?.connectionState !== 'connected') {
        console.warn("Connection timed out. Resetting and finding a new partner.");
        //this.hangUp(true); // `true` tells it to find a new partner
          this.onPartnerDisconnect();
      }
    }, 6000); // 6,000 milliseconds = 6 seconds

  
    
    this.roomId = roomId;
    this.partnerId = partnerId;
    this.createPeerConnection();
    this.pollForSignalingMessages();
    if (this.isOfferCreator) {
      await this.createOffer();
    }
  }

 // pages/index.tsx (in the ChatController class)

private pollForSignalingMessages = () => {
  this.stopSignalingPolling();
  this.signalingPollingInterval = setInterval(async () => {
          console.log("In pollforsingnallingmessages");

    if (!this.roomId) return;
    const { data: messages } = await supabase
      .from('signaling')
      .select('id, payload')
      .eq('recipient_id', this.userId)
      .eq('room_id', this.roomId);

    if (messages && messages.length > 0) {
      const messageIds = messages.map(m => m.id);

      // ✅ ADDED: Error handling for the delete operation
      const { error: deleteError } = await supabase
        .from('signaling')
        .delete()
        .in('id', messageIds);

      if (deleteError) {
        console.error("❌ FAILED to delete signaling messages:", deleteError);
      } else {
        console.log(`✅ Successfully deleted ${messageIds.length} signaling messages.`);
      }
      
      for (const msg of messages) {
        if (!this.pc) continue;
        const { type, sdp, candidate } = msg.payload;
        try {
          if (type === 'offer') {
            await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            await this.sendSignalingMessage({ type: 'answer', sdp: this.pc.localDescription?.sdp });
          } else if (type === 'answer') {
            await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
          } else if (type === 'candidate' && this.pc.remoteDescription) {
            await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
        } catch (e) { console.error("Signaling error:", e) }
      }
    }
  }, 1500);
}
  private stopSignalingPolling = () => { if (this.signalingPollingInterval) clearInterval(this.signalingPollingInterval); this.signalingPollingInterval = null; }
  
  private sendSignalingMessage = async (payload: any) => {
    console.log("In sendsignal message");
    if (this.partnerId && this.roomId) {
      await supabase.from('signaling').insert({ room_id: this.roomId, recipient_id: this.partnerId, payload });
    }
  }
  
  private createPeerConnection = (): void => {
  if (this.pc) return; 
  this.pc = new RTCPeerConnection({ iceServers });
  this.pc.onicecandidate = async (e) => { if (e.candidate) await this.sendSignalingMessage({ type: 'candidate', candidate: e.candidate }); };
  
  // ✅ UPDATED ONSCONNECTIONSTATECHANGE
  this.pc.onconnectionstatechange = () => { 
    const state = this.pc?.connectionState; 
    if (state === 'connected') {
      if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
      this.setState('CONNECTED'); 
    } else if (state === 'disconnected' || state === 'failed') {
      // Always call the simple hangup, never reconnect automatically
     // this.hangUp(); 78
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

  // pages/index.tsx (in the ChatController class)

private cleanup = async (): Promise<void> => {
  if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }

  this.stopPolling(); 
 
  this.stopSignalingPolling();
  this.pc?.close();
  this.pc = null;
  this.isOfferCreator = false;
  this.roomId = null;
  this.partnerId = null;

  // ✅ ADD THIS: Clean up leftover signaling messages
  await supabase.from('signaling').delete().eq('recipient_id', this.userId);
}  
 // pages/index.tsx (in the ChatController class)

public hangUp = async (reconnect: boolean = false): Promise<void> => {
  // 1. Clear the remote video stream from the UI
  this.onRemoteStream(null);

  // 2. Clean up local state (polling intervals, peer connection)
  await this.cleanup();

  // 3. Call your Edge Function to clean the database
  await supabase.functions.invoke('cleanup-notifications', {
    body: { userId: this.userId }
  });

  // 4. Decide what to do next
  if (reconnect) {
    // For "Skip", immediately start the next search
    this.startChat({ sex: 'any', city: '', country: '', interests: []  });
  } else {
    // For "End Call", return to the home screen
    this.setState('IDLE');
  }
}

  
  public toggleMute = (): void => { this.localStream?.getAudioTracks().forEach(t => t.enabled = !t.enabled); }
  public toggleVideo = (): void => { this.localStream?.getVideoTracks().forEach(t => t.enabled = !t.enabled); }
}

// --- Main React Component ---
const Home: FC = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [appState, setAppState] = useState<AppState>('IDLE');
  const [matchingPrefs, setMatchingPrefs] = useState<MatchingPreferences>({ sex: 'any', city: '', country: '',  interests: [] });
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const controllerRef = useRef<ChatController | null>(null);
  const [onlineCount, setOnlineCount] = useState(0); // ✅ NEW: State for online count
  const [isAutoRequeuing, setIsAutoRequeuing] = useState(false); // ✅ NEW: State for auto-reconnect
  
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
        if (isAutoRequeuing) {
          controllerRef.current?.hangUp(true); // Automatically find new partner
        } else {
          controllerRef.current?.hangUp(false); // Go back to the home screen
        }
      };
      const chatController = new ChatController(session.user.id, setAppState, setLocalStream, setRemoteStream, handlePartnerDisconnect);
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
      <ProfileSetupModal user={session.user} onComplete={() => window.location.reload()} />
    )}
    <main className="h-screen w-screen bg-black flex font-sans">
      <OnlineCounter onlineCount={onlineCount} />
      <div className="flex-1 flex flex-col relative">
        <header className="absolute top-0 left-0 right-0 z-30 h-[72px] flex items-center px-6 justify-between bg-gradient-to-b from-black/50 to-transparent text-white">
          <h1 className="text-xl font-semibold">Chat App</h1>
        </header>

        <div className="absolute inset-0 z-0">
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-contain bg-black" />
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