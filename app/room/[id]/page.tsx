'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { 
  EstimationTrack, 
  FactorScores, 
  DeckStyle,
  DECKS,
  TRACK_FACTORS,
  mapScoreToCard, 
  calculateCompositeScore,
  getInitialFactors
} from '@/lib/estimation';
import { AIEstimateResult } from '@/lib/gemini';
import { audio } from '@/lib/audio';

type ThemeName = 'space' | 'cyberpunk' | 'tavern' | 'arcade';

interface Participant {
  presenceRef: string;
  userId: string;
  name: string;
  joinedAt: number;
  isHost: boolean;
  voteCast: boolean;
  voteValue?: string;
  factors?: FactorScores | null;
}

interface CompletedRound {
  id: string;
  ticketTitle: string;
  track: EstimationTrack;
  average: string;
  consensus: string;
  acceptedValue: string;
  timestamp: number;
}

const THEME_LABELS = {
  space: {
    title: "Command Deck Context",
    solutionCertainty: { label: "Command Certainty", desc1: "1: Fully Cleared", desc5: "5: Heavy Probes Needed" },
    blastRadius: { label: "Sector Blast Radius", desc1: "1: Minor Component", desc5: "5: Warp Core Explosion" },
    validationMoat: { label: "Shield Validation", desc1: "1: Diagnostic Run", desc5: "5: Deep Simulation Run" },
    externalCoordination: { label: "Subspace Coordination", desc1: "1: Self-Contained", desc5: "5: Fleet-wide Sync" }
  },
  cyberpunk: {
    title: "Netrunner Node",
    solutionCertainty: { label: "Decryption Feasibility", desc1: "1: Simple script", desc5: "5: AI Firewall Bypass" },
    blastRadius: { label: "Grid Alert Level", desc1: "1: Sub-node patch", desc5: "5: Global Grid Shutdown" },
    validationMoat: { label: "Compiler Sandboxing", desc1: "1: Sandbox build", desc5: "5: Core Net-Run Test" },
    externalCoordination: { label: "Node Coordination", desc1: "1: Standalone node", desc5: "5: Multi-subnet Sync" }
  },
  tavern: {
    title: "Guild Quest Scroll",
    solutionCertainty: { label: "Scroll Certainty", desc1: "1: Simple cantrip", desc5: "5: Ancient Magic Rune" },
    blastRadius: { label: "Dragon Blast Radius", desc1: "1: Fireball fizzle", desc5: "5: Kingdom Destruction" },
    validationMoat: { label: "Spell Integrity", desc1: "1: Simple Ward", desc5: "5: Trial of Elements" },
    externalCoordination: { label: "Guild Coordination", desc1: "1: Solo Quest", desc5: "5: Alliance Raid Call" }
  },
  arcade: {
    title: "Arcade Cabinet Options",
    solutionCertainty: { label: "Combo Feasibility", desc1: "1: Button masher", desc5: "5: Frame-perfect Combo" },
    blastRadius: { label: "Boss Damage Level", desc1: "1: Minor hitpoint loss", desc5: "5: Instant Game Over" },
    validationMoat: { label: "Bug Immunity Moat", desc1: "1: Local patch", desc5: "5: Full Cabinet QA" },
    externalCoordination: { label: "Co-Op Coordination", desc1: "1: Single player", desc5: "5: 4-Player Local Sync" }
  }
};

export default function Room() {
  const params = useParams();
  const router = useRouter();
  const roomId = (params.id as string).toUpperCase();

  // Theme & Mode Settings
  const [currentTheme, setCurrentTheme] = useState<ThemeName>('space');
  const [isDarkMode, setIsDarkMode] = useState(true);

  // User details
  const [username, setUsername] = useState('');
  const [userId, setUserId] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [joinedAt, setJoinedAt] = useState<number>(0);

  // Connection & Room state
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [revealed, setRevealed] = useState(false);

  // Ticket State (Syncs from Host)
  const [ticketTitle, setTicketTitle] = useState('');
  const [ticketDesc, setTicketDesc] = useState('');
  const [currentTrack, setCurrentTrack] = useState<EstimationTrack>('human');
  const [inviteAI, setInviteAI] = useState(false);
  const [isRoundActive, setIsRoundActive] = useState(false);

  // Player Vote State
  const [factors, setFactors] = useState<FactorScores>(getInitialFactors('human'));
  const [selectedCard, setSelectedCard] = useState<string | null>(null);

  // AI Estimate state
  const [aiEstimate, setAiEstimate] = useState<AIEstimateResult | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState(false);
  const [deckStyle, setDeckStyle] = useState<DeckStyle>('scrum');

  // Round History & Completed States
  const [roundsHistory, setRoundsHistory] = useState<CompletedRound[]>([]);
  const [acceptedValue, setAcceptedValue] = useState<string>('');
  const [sessionEnded, setSessionEnded] = useState(false);

  // Clipboard copy feedback
  const [copied, setCopied] = useState(false);

  // Ref to hold the Supabase channel
  const channelRef = useRef<RealtimeChannel | null>(null);
  const stateRef = useRef({ ticketTitle, ticketDesc, currentTrack, inviteAI, isHost, currentTheme, deckStyle });

  // Update state ref to prevent stale closures in realtime events
  useEffect(() => {
    stateRef.current = { ticketTitle, ticketDesc, currentTrack, inviteAI, isHost, currentTheme, deckStyle };
  }, [ticketTitle, ticketDesc, currentTrack, inviteAI, isHost, currentTheme, deckStyle]);

  // Sync factors layout when track updates
  useEffect(() => {
    setFactors(getInitialFactors(currentTrack));
    if (currentTrack === 'human') setDeckStyle('scrum');
    else if (currentTrack === 'hybrid') setDeckStyle('hybrid');
    else if (currentTrack === 'autonomous') setDeckStyle('autonomous');
  }, [currentTrack]);

  // Load Saved Themes
  useEffect(() => {
    const savedTheme = localStorage.getItem('cogpoker_theme') as ThemeName;
    if (savedTheme) setCurrentTheme(savedTheme);

    const savedMode = localStorage.getItem('cogpoker_darkmode');
    if (savedMode) setIsDarkMode(savedMode === 'true');
  }, []);

  // Apply active theme to document elements
  useEffect(() => {
    // Remove old theme and mode classes from document root
    document.documentElement.classList.remove('theme-space', 'theme-cyberpunk', 'theme-tavern', 'theme-arcade');
    document.documentElement.classList.remove('mode-dark', 'mode-light');

    // Add current theme and mode classes
    document.documentElement.classList.add(`theme-${currentTheme}`);
    document.documentElement.classList.add(isDarkMode ? 'mode-dark' : 'mode-light');

    // Also apply to body for styling containment
    document.body.className = `min-h-full flex flex-col theme-${currentTheme} ${isDarkMode ? 'mode-dark' : 'mode-light'}`;
  }, [currentTheme, isDarkMode]);

  // 1. Initial setup - Read username, set user ID
  useEffect(() => {
    const savedName = localStorage.getItem('cogpoker_username');
    if (!savedName) {
      router.push(`/?room=${roomId}`);
      return;
    }
    setUsername(savedName);

    let savedId = sessionStorage.getItem('cogpoker_userid');
    if (!savedId) {
      savedId = Math.random().toString(36).substring(2, 11);
      sessionStorage.setItem('cogpoker_userid', savedId);
    }
    setUserId(savedId);

    let savedJoinedAt = sessionStorage.getItem(`cogpoker_joined_at_${roomId}`);
    let timestamp = Date.now();
    if (savedJoinedAt) {
      timestamp = parseInt(savedJoinedAt);
    } else {
      sessionStorage.setItem(`cogpoker_joined_at_${roomId}`, timestamp.toString());
    }
    setJoinedAt(timestamp);

    const isCreator = sessionStorage.getItem(`cogpoker_creator_${roomId}`) === 'true';
    setIsHost(isCreator);
  }, [roomId, router]);

  const applyLocalTicketUpdate = (title: string, desc: string, track: EstimationTrack, ai: boolean, style?: DeckStyle) => {
    console.log('Applying ticket update locally:', { title, desc, track, ai, style });
    
    // Check if the ticket details actually changed.
    // If they did not change, do NOT clear the player's vote/selectedCard!
    const isDifferentTicket =
      title !== stateRef.current.ticketTitle ||
      desc !== stateRef.current.ticketDesc ||
      track !== stateRef.current.currentTrack;

    setTicketTitle(title);
    setTicketDesc(desc);
    setCurrentTrack(track);
    setInviteAI(ai);
    if (style) {
      setDeckStyle(style);
    }
    
    // Set round as active if there is an active ticket title
    setIsRoundActive(title !== '');
    
    if (isDifferentTicket) {
      console.log('Ticket details changed. Resetting votes and AI estimate.');
      setRevealed(false);
      setSelectedCard(null);
      setAiEstimate(null);
      setAcceptedValue('');
    } else {
      console.log('Ticket details unchanged (sync). Preserving current votes.');
    }
  };

  const applyLocalResetRound = () => {
    console.log('Resetting round locally');
    setRevealed(false);
    setAiEstimate(null);
    setAiError(false);
    setAcceptedValue('');
    setFactors(getInitialFactors(currentTrack));
    setSelectedCard(null);
    setIsRoundActive(false);
  };

  // 2. Setup Supabase Realtime Channel
  useEffect(() => {
    if (!userId || !username || !joinedAt) return;

    console.log('Subscribing to channel room-', roomId);

    const channel = supabase.channel(`room-${roomId}`, {
      config: {
        presence: {
          key: userId,
        },
      },
    });

    channelRef.current = channel;

    // Handle incoming broadcasts
    channel
      .on('broadcast', { event: 'TICKET_UPDATE' }, ({ payload }) => {
        console.log('Received TICKET_UPDATE broadcast:', payload);
        applyLocalTicketUpdate(payload.title, payload.desc, payload.track, payload.inviteAI, payload.deckStyle);
      })
      .on('broadcast', { event: 'REVEAL_CARDS' }, () => {
        console.log('Received REVEAL_CARDS broadcast');
        audio.playReveal(stateRef.current.currentTheme);
        setRevealed(true);
      })
      .on('broadcast', { event: 'RESET_ROUND' }, () => {
        console.log('Received RESET_ROUND broadcast');
        audio.playReset(stateRef.current.currentTheme);
        setParticipants(prev => prev.map(p => ({ ...p, voteCast: false, voteValue: undefined })));
        applyLocalResetRound();
      })
      .on('broadcast', { event: 'AI_ESTIMATE_BROADCAST' }, ({ payload }) => {
        console.log('Received AI_ESTIMATE_BROADCAST:', payload);
        if (payload.error) {
          setAiEstimate(null);
          setAiError(true);
        } else {
          setAiEstimate(payload.estimate);
          setAiError(false);
        }
      })
      .on('broadcast', { event: 'ROUND_COMPLETED' }, ({ payload }) => {
        console.log('Received ROUND_COMPLETED broadcast:', payload);
        audio.playComplete(stateRef.current.currentTheme);
        setRoundsHistory(prev => {
          if (prev.some(r => r.id === payload.completedRound.id)) return prev;
          return [...prev, payload.completedRound];
        });
        setParticipants(prev => prev.map(p => ({ ...p, voteCast: false, voteValue: undefined })));
        applyLocalResetRound();
        setTicketTitle('');
        setTicketDesc('');
      })
      .on('broadcast', { event: 'END_SESSION' }, () => {
        console.log('Received END_SESSION broadcast from Host');
        audio.playReset(stateRef.current.currentTheme);
        setSessionEnded(true);
        setTimeout(() => {
          sessionStorage.removeItem('cogpoker_userid');
          sessionStorage.removeItem('cogpoker_joined_at');
          router.push('/');
        }, 2500);
      });

    // Handle Presence state tracking
    channel.on('presence', { event: 'sync' }, () => {
      const presenceState = channel.presenceState();
      const updatedParticipants: Participant[] = [];

      Object.keys(presenceState).forEach((key) => {
        const presences = presenceState[key] as any[];
        // CRITICAL BUG FIX: Only take the latest presence record per userId to prevent card duplication
        if (presences.length > 0) {
          const p = presences[presences.length - 1];
          updatedParticipants.push({
            presenceRef: p.presence_ref,
            userId: key,
            name: p.name,
            joinedAt: p.joinedAt || Date.now(),
            isHost: p.isHost || false,
            voteCast: p.voteCast || false,
            voteValue: p.voteValue,
            factors: p.factors,
          });
        }
      });

      // Map participants to preserve their tracked isHost flags
      const mappedParticipants = updatedParticipants.map((p) => ({
        ...p,
        isHost: p.isHost || false,
      }));

      const sortedMapped = [...mappedParticipants].sort((a, b) => a.joinedAt - b.joinedAt);
      console.log(`[PRESENCE DEBUG] User: ${username} (Host: ${stateRef.current.isHost}) - Participants:`, JSON.stringify(sortedMapped.map(p => ({ name: p.name, isHost: p.isHost, voteCast: p.voteCast, voteValue: p.voteValue }))));
      setParticipants(sortedMapped);

      // Find if there is an active host in the room
      const hostParticipant = sortedMapped.find((p) => p.isHost);
      const hostExists = !!hostParticipant;

      // If no active Host exists, promote the oldest participant in the room
      if (!hostExists && sortedMapped.length > 0) {
        const oldest = sortedMapped[0];
        console.log(`No active Host found in room. Promoting oldest participant: ${oldest.name}`);
        if (oldest.userId === userId) {
          setIsHost(true);
          sessionStorage.setItem(`cogpoker_creator_${roomId}`, 'true');
        }
      }

      // If we are NOT the host, ask host to sync ticket details if title is empty
      if (hostExists && !stateRef.current.isHost && !stateRef.current.ticketTitle) {
        console.log('Not host. Requesting ticket sync from host.');
        channel.send({
          type: 'broadcast',
          event: 'REQUEST_TICKET_SYNC',
          payload: { requesterId: userId }
        });
      }
    });

    // Handle request from peer to sync ticket details
    channel.on('broadcast', { event: 'REQUEST_TICKET_SYNC' }, () => {
      if (stateRef.current.isHost) {
        console.log('Peer requested ticket sync. Broadcasting current state.');
        broadcastTicketUpdate(
          stateRef.current.ticketTitle,
          stateRef.current.ticketDesc,
          stateRef.current.currentTrack,
          stateRef.current.inviteAI
        );
      }
    });

    // Join channel
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        setIsConnected(true);
        console.log('Realtime channel subscribed successfully.');
        // Track presence
        await channel.track({
          name: username,
          joinedAt: joinedAt,
          isHost: isHost,
          voteCast: selectedCard !== null,
          voteValue: selectedCard,
          factors: factors,
        });
      } else {
        setIsConnected(false);
        console.warn('Realtime channel subscription status:', status);
      }
    });

    const handleBeforeUnload = () => {
      channel.unsubscribe();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [userId, username, joinedAt, roomId]);

  // Sync vote updates to Presence
  useEffect(() => {
    if (channelRef.current && isConnected) {
      channelRef.current.track({
        name: username,
        joinedAt: joinedAt,
        isHost: isHost,
        voteCast: selectedCard !== null,
        voteValue: selectedCard,
        factors: factors,
      });
    }
  }, [selectedCard, factors, isConnected, username, joinedAt, isHost]);

  // Helper: Broadcast ticket details
  const broadcastTicketUpdate = async (title: string, desc: string, track: EstimationTrack, ai: boolean, style?: DeckStyle) => {
    if (channelRef.current) {
      try {
        const payloadStyle = style || stateRef.current.deckStyle || 'scrum';
        console.log('Sending TICKET_UPDATE broadcast:', { title, desc, track, inviteAI: ai, deckStyle: payloadStyle });
        const status = await channelRef.current.send({
          type: 'broadcast',
          event: 'TICKET_UPDATE',
          payload: { title, desc, track, inviteAI: ai, deckStyle: payloadStyle },
        });
        console.log('TICKET_UPDATE broadcast status:', status);
      } catch (err) {
        console.error('Error sending TICKET_UPDATE broadcast:', err);
      }
    } else {
      console.error('Failed to broadcast: channelRef.current is invalid.');
    }
  };

  // Host Action: Save and update ticket
  const handleUpdateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isHost) return;

    applyLocalTicketUpdate(ticketTitle, ticketDesc, currentTrack, inviteAI, deckStyle);
    broadcastTicketUpdate(ticketTitle, ticketDesc, currentTrack, inviteAI, deckStyle);

    if (inviteAI) {
      triggerAIEstimate();
    }
  };

  // Host Action: Trigger Card Reveal
  const handleReveal = async () => {
    if (!isHost || !channelRef.current) return;
    try {
      console.log('Sending REVEAL_CARDS broadcast');
      audio.playReveal(currentTheme);
      const status = await channelRef.current.send({
        type: 'broadcast',
        event: 'REVEAL_CARDS',
      });
      console.log('REVEAL_CARDS broadcast status:', status);
      setRevealed(true);
    } catch (err) {
      console.error('Error sending REVEAL_CARDS broadcast:', err);
    }
  };

  // Host Action: Reset Round
  const handleResetRound = async () => {
    if (!isHost || !channelRef.current) return;
    try {
      audio.playReset(currentTheme);
      const status = await channelRef.current.send({
        type: 'broadcast',
        event: 'RESET_ROUND',
      });
      console.log('RESET_ROUND broadcast status:', status);
      setParticipants(prev => prev.map(p => ({ ...p, voteCast: false, voteValue: undefined })));
      applyLocalResetRound();
    } catch (err) {
      console.error('Error sending RESET_ROUND broadcast:', err);
    }
  };

  // Host Action: Save and Complete Round
  const handleCompleteRound = async () => {
    if (!isHost || !acceptedValue || !channelRef.current) return;

    const roundData: CompletedRound = {
      id: Math.random().toString(36).substring(2, 9).toUpperCase(),
      ticketTitle,
      track: currentTrack,
      average: stats.average,
      consensus: stats.consensus,
      acceptedValue,
      timestamp: Date.now()
    };

    try {
      console.log('Sending ROUND_COMPLETED broadcast:', roundData);
      audio.playComplete(currentTheme);
      const status = await channelRef.current.send({
        type: 'broadcast',
        event: 'ROUND_COMPLETED',
        payload: { completedRound: roundData }
      });
      console.log('ROUND_COMPLETED broadcast status:', status);

      setRoundsHistory(prev => {
        if (prev.some(r => r.id === roundData.id)) return prev;
        return [...prev, roundData];
      });
      setParticipants(prev => prev.map(p => ({ ...p, voteCast: false, voteValue: undefined })));
      applyLocalResetRound();
      setTicketTitle('');
      setTicketDesc('');
    } catch (err) {
      console.error('Error sending ROUND_COMPLETED broadcast:', err);
    }
  };

  // Host Action: Call AI endpoint and broadcast result
  const triggerAIEstimate = async () => {
    if (!ticketTitle) return;
    setIsAiLoading(true);
    setAiError(false);
    try {
      const res = await fetch('/api/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: ticketTitle,
          description: ticketDesc,
          track: currentTrack,
          deckStyle: deckStyle,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setAiEstimate(data);
        setAiError(false);
        // Broadcast AI result to everyone
        if (channelRef.current) {
          try {
            console.log('Sending AI_ESTIMATE_BROADCAST broadcast:', data);
            const status = await channelRef.current.send({
              type: 'broadcast',
              event: 'AI_ESTIMATE_BROADCAST',
              payload: { estimate: data, error: false },
            });
            console.log('AI_ESTIMATE_BROADCAST status:', status);
          } catch (broadcastErr) {
            console.error('Error sending AI_ESTIMATE_BROADCAST:', broadcastErr);
          }
        }
      } else {
        throw new Error('Server returned unsuccessful status');
      }
    } catch (err) {
      console.error('Error fetching AI estimate:', err);
      setAiEstimate(null);
      setAiError(true);
      // Broadcast error status to all players
      if (channelRef.current) {
        try {
          await channelRef.current.send({
            type: 'broadcast',
            event: 'AI_ESTIMATE_BROADCAST',
            payload: { estimate: null, error: true },
          });
        } catch (broadcastErr) {
          console.error('Error broadcasting AI failure:', broadcastErr);
        }
      }
    } finally {
      setIsAiLoading(false);
    }
  };

  // Leave current room
  const handleLeaveRoom = () => {
    if (channelRef.current) {
      channelRef.current.unsubscribe();
    }
    audio.playReset(currentTheme);
    sessionStorage.removeItem('cogpoker_userid');
    sessionStorage.removeItem('cogpoker_joined_at');
    router.push('/');
  };

  // End entire session (Host only)
  const handleEndSession = async () => {
    if (!isHost || !channelRef.current) return;
    try {
      console.log('Broadcasting END_SESSION to all players...');
      audio.playReset(currentTheme);
      const status = await channelRef.current.send({
        type: 'broadcast',
        event: 'END_SESSION',
      });
      console.log('END_SESSION broadcast status:', status);
    } catch (err) {
      console.error('Error sending END_SESSION broadcast:', err);
    }
    
    if (channelRef.current) {
      channelRef.current.unsubscribe();
    }
    sessionStorage.removeItem('cogpoker_userid');
    sessionStorage.removeItem('cogpoker_joined_at');
    router.push('/');
  };

  // Change deck style and broadcast
  const handleDeckStyleChange = (style: DeckStyle) => {
    setDeckStyle(style);
    if (ticketTitle) {
      applyLocalTicketUpdate(ticketTitle, ticketDesc, currentTrack, inviteAI, style);
      broadcastTicketUpdate(ticketTitle, ticketDesc, currentTrack, inviteAI, style);
    }
  };

  // Player action: Change factor score
  const handleFactorChange = (key: string, val: number) => {
    if (isHost || !ticketTitle || selectedCard !== null) return;
    setFactors(prev => ({
      ...prev,
      [key]: val
    }));
  };

  // Player action: Select/cast card
  const handleCastCard = (card: string) => {
    if (isHost || !ticketTitle || revealed) return;

    if (selectedCard === card) {
      setSelectedCard(null); // Deselect
      audio.playReset(currentTheme);
    } else if (selectedCard === null) {
      setSelectedCard(card); // Lock vote
      audio.playVote(currentTheme);
    }
  };

  // Change active theme
  const toggleTheme = (theme: ThemeName) => {
    setCurrentTheme(theme);
    localStorage.setItem('cogpoker_theme', theme);
  };

  // Toggle Dark Mode
  const toggleDarkMode = () => {
    setIsDarkMode(prev => {
      localStorage.setItem('cogpoker_darkmode', (!prev).toString());
      return !prev;
    });
  };

  // Copy shareable link
  const handleCopyLink = () => {
    const shareUrl = `${window.location.origin}/?room=${roomId}`;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Recommended card calculation based on current sliders
  const recommendedCard = mapScoreToCard(deckStyle, factors, currentTrack);

  // Filter estimators to exclude the Host
  const votingEstimators = participants.filter(p => !p.isHost);

  // Statistics calculation for revealed phase
  const getResultsSummary = () => {
    const votes = votingEstimators
      .map(p => p.voteValue)
      .filter((v): v is string => !!v);

    if (aiEstimate?.card) {
      votes.push(aiEstimate.card);
    }

    if (votes.length === 0) return { average: 'N/A', consensus: 'N/A' };

    if (currentTrack !== 'autonomous') {
      const numericVotes = votes.map(v => parseFloat(v)).filter(n => !isNaN(n));
      if (numericVotes.length > 0) {
        const sum = numericVotes.reduce((a, b) => a + b, 0);
        const avg = (sum / numericVotes.length).toFixed(1);
        return { average: avg, consensus: getConsensus(votes) };
      }
    }

    return { average: 'Non-numeric scale', consensus: getConsensus(votes) };
  };

  const getConsensus = (votes: string[]): string => {
    const counts: Record<string, number> = {};
    let maxCount = 0;
    let mode = 'N/A';

    votes.forEach(v => {
      counts[v] = (counts[v] || 0) + 1;
      if (counts[v] > maxCount) {
        maxCount = counts[v];
        mode = v;
      }
    });

    return maxCount > 1 ? `${mode} (${maxCount} votes)` : 'No consensus';
  };

  const stats = getResultsSummary();
  const themeLabels = THEME_LABELS[currentTheme];

  return (
    <div className={`min-h-screen flex flex-col relative overflow-hidden theme-container theme-${currentTheme} ${isDarkMode ? 'mode-dark' : 'mode-light'} bg-[var(--bg-color)] text-[var(--text-color)] font-[family-name:var(--theme-font)] transition-all`}>
      
      {/* Visual themed grid overlays */}
      {currentTheme === 'cyberpunk' && (
        <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[size:100%_4px,6px_100%] pointer-events-none z-30" />
      )}
      {currentTheme === 'space' && (
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_top,rgba(16,24,48,0.2),transparent_70%)] pointer-events-none" />
      )}

      {/* Top Navbar */}
      <header className="border-b border-[var(--border-color)] bg-[var(--card-bg)] px-6 py-4 flex flex-wrap items-center justify-between gap-4 relative z-20">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center p-2 border border-[var(--border-color)] rounded-lg theme-accent-text cursor-pointer" onClick={() => router.push('/')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight theme-accent-text">
              CogPoker
            </h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
              <span className="text-[10px] theme-text-muted uppercase tracking-widest font-semibold">
                {isConnected ? 'connected' : 'disconnected'}
              </span>
            </div>
          </div>
        </div>

        {/* Global Controls */}
        <div className="flex items-center flex-wrap gap-3">
          
          {/* Theme Selector */}
          <div className="flex items-center gap-1.5 bg-[var(--bg-color)] border border-[var(--border-color)] rounded-lg px-2.5 py-1">
            <span className="text-[10px] theme-text-muted font-bold uppercase tracking-wider">Theme:</span>
            <div className="flex gap-1">
              {(['space', 'cyberpunk', 'tavern', 'arcade'] as ThemeName[]).map((t) => (
                <button
                  key={t}
                  onClick={() => toggleTheme(t)}
                  className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded transition-all ${
                    currentTheme === t 
                      ? 'theme-accent-bg text-[var(--bg-color)]' 
                      : 'theme-text-muted hover:text-[var(--text-color)]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Light/Dark Toggle */}
          <button
            onClick={toggleDarkMode}
            className="p-1.5 bg-[var(--bg-color)] border border-[var(--border-color)] hover:theme-accent-border rounded-lg theme-text-muted hover:theme-accent-text transition-colors"
            title="Toggle Light/Dark Mode"
          >
            {isDarkMode ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
            )}
          </button>

          {/* User Profile Badge */}
          {username && (
            <div className="flex items-center gap-2 bg-[var(--bg-color)] border border-[var(--border-color)] rounded-lg px-2.5 py-1.5 text-xs font-semibold select-none">
              <div className="w-5 h-5 rounded-full bg-[var(--accent-glow)] border border-[var(--accent-color)] flex items-center justify-center text-[10px] font-extrabold theme-accent-text uppercase">
                {username.charAt(0)}
              </div>
              <span className="font-bold text-[var(--text-color)] max-w-[80px] sm:max-w-[120px] truncate">{username}</span>
              <span className={`text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded ${
                isHost 
                  ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400' 
                  : 'bg-blue-500/10 border border-blue-500/20 text-blue-400'
              }`}>
                {isHost ? 'Host' : 'Player'}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 bg-[var(--bg-color)] border border-[var(--border-color)] rounded-lg px-3 py-1.5 text-xs font-bold theme-accent-text tracking-wider">
            ROOM: {roomId}
          </div>

          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1.5 text-xs theme-accent-glow-bg theme-accent-text border border-[var(--border-color)] px-3.5 py-1.5 rounded-lg font-bold transition-all hover:theme-accent-border"
          >
            {copied ? 'Link Copied' : 'Invite Link'}
          </button>

          <button
            onClick={handleLeaveRoom}
            className="flex items-center gap-1.5 text-xs bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/20 px-3.5 py-1.5 rounded-lg font-bold transition-all hover:border-rose-500/40"
          >
            Leave Room
          </button>
        </div>
      </header>

      {/* Dynamic Views: Moderator Console vs Player Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 overflow-y-auto z-10">
        {isHost ? (
          /* ========================================================================= */
          /* MODERATOR COMMAND CENTER                                                   */
          /* ========================================================================= */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch h-full animate-fade-in">
            {/* Left Panel: Ticket Configuration & Actions */}
            <div className="lg:col-span-5 flex flex-col gap-6">
              
              {/* Ticket details form */}
              <div className="theme-card p-6 flex flex-col gap-5">
                <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider theme-text-muted">
                    {themeLabels.title} (Moderator)
                  </h3>
                  <span className="text-[10px] theme-accent-glow-bg theme-accent-text border border-[var(--border-color)] font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                    Host Control
                  </span>
                </div>

                <form onSubmit={handleUpdateTicket} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] theme-text-muted font-bold uppercase tracking-wider">Ticket Title</label>
                    <input
                      id="ticket-title"
                      type="text"
                      required
                      disabled={isRoundActive}
                      value={ticketTitle}
                      onChange={(e) => setTicketTitle(e.target.value)}
                      placeholder="e.g. Implement user auth fallback"
                      className="px-3.5 py-2.5 bg-[var(--bg-color)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-color)] focus:outline-none focus:theme-accent-border transition-colors font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] theme-text-muted font-bold uppercase tracking-wider">Ticket Description</label>
                    <textarea
                      id="ticket-desc"
                      disabled={isRoundActive}
                      value={ticketDesc}
                      onChange={(e) => setTicketDesc(e.target.value)}
                      placeholder="Provide core architecture details, dependencies, and validation guidelines..."
                      rows={4}
                      className="px-3.5 py-2.5 bg-[var(--bg-color)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-color)] focus:outline-none focus:theme-accent-border transition-colors resize-none font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] theme-text-muted font-bold uppercase tracking-wider">Scoring Track</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['human', 'hybrid', 'autonomous'] as EstimationTrack[]).map((t) => (
                        <button
                          key={t}
                          type="button"
                          disabled={isRoundActive}
                          onClick={() => setCurrentTrack(t)}
                          className={`py-2 px-1 text-center font-bold text-[10px] rounded-lg uppercase tracking-wider border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                            currentTrack === t 
                              ? 'theme-accent-glow-bg theme-accent-text border-[var(--accent-color)] shadow-sm' 
                              : 'bg-[var(--bg-color)] border-[var(--border-color)] theme-text-muted hover:theme-accent-text'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] theme-text-muted font-bold uppercase tracking-wider">Choose Card Deck</label>
                    <select
                      disabled={isRoundActive}
                      value={deckStyle}
                      onChange={(e) => handleDeckStyleChange(e.target.value as DeckStyle)}
                      className="w-full px-3.5 py-2.5 bg-[var(--bg-color)] border border-[var(--border-color)] rounded-lg text-xs font-bold text-[var(--text-color)] focus:outline-none focus:theme-accent-border transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <option value="scrum">Scrum: 0, ½, 1, 2, 3, 5, 8, 13, 20, 40, 100, ?</option>
                      <option value="fibonacci">Fibonacci: 0, ½, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, ?</option>
                      <option value="sequential">Sequential: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, ?</option>
                      <option value="hourly">Hourly: 0, 4, 8, 16, 24, 32, 40, 60, 80, ?</option>
                      <option value="tshirt">T-Shirt: XXS, XS, S, M, L, XL, XXL, ?</option>
                      <option value="hybrid">Hybrid (Fractional): 0.5, 1, 1.5, 2, 3, 5, 8, 12, 20, ?</option>
                      <option value="autonomous">Autonomous (Token): 8k, 16k, 32k, 64k, 128k, 256k, 512k, 1M, ?</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between bg-[var(--bg-color)] border border-[var(--border-color)] rounded-lg p-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-bold text-[var(--text-color)]">Invite AI Estimator</span>
                      <span className="text-[10px] theme-text-muted">Calculates peer AI recommendation</span>
                    </div>
                    <button
                      type="button"
                      disabled={isRoundActive}
                      onClick={() => setInviteAI(!inviteAI)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed ${
                        inviteAI ? 'theme-accent-bg' : 'bg-[var(--border-color)]'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          inviteAI ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={isRoundActive}
                    className={`w-full py-3 font-bold rounded-lg text-xs tracking-wider uppercase transition-all shadow-md disabled:cursor-not-allowed ${
                      isRoundActive 
                        ? 'bg-[var(--border-color)] theme-text-muted border border-[var(--border-color)] opacity-60' 
                        : 'theme-accent-bg text-[var(--bg-color)] hover:opacity-90 active:scale-[0.99]'
                    }`}
                  >
                    {isRoundActive ? 'Round in Progress (Locked)' : 'Broadcast Ticket Update'}
                  </button>
                </form>
              </div>

              {/* Moderator Controls Dashboard */}
              <div className="theme-card p-6 flex flex-col gap-4">
                <h3 className="text-xs font-bold uppercase tracking-wider theme-text-muted border-b border-[var(--border-color)] pb-3">
                  Moderator Action Panel
                </h3>
                
                <div className="flex flex-col gap-3">
                  <button
                    onClick={handleReveal}
                    disabled={revealed || !ticketTitle || votingEstimators.filter(p => !!p.voteValue).length === 0}
                    className="w-full py-3.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:from-slate-800 disabled:to-slate-850 disabled:text-slate-500 disabled:border-slate-800/50 disabled:cursor-not-allowed text-white font-extrabold rounded-lg text-xs uppercase tracking-wider transition-all"
                  >
                    {!ticketTitle 
                      ? 'Reveal Player Cards' 
                      : revealed 
                        ? 'Cards Revealed' 
                        : votingEstimators.filter(p => !!p.voteValue).length === 0 
                          ? 'Reveal Player Cards (Waiting for Votes)' 
                          : votingEstimators.filter(p => !!p.voteValue).length === votingEstimators.length 
                            ? 'Reveal Player Cards (All Voted!)' 
                            : `Reveal Player Cards (${votingEstimators.filter(p => !!p.voteValue).length}/${votingEstimators.length} Voted)`
                    }
                  </button>

                  {revealed && (
                    <div className="mt-2 border-t border-[var(--border-color)] pt-3 flex flex-col gap-3 animate-fade-in">
                      <div className="flex flex-col gap-2">
                        <label className="text-[10px] theme-text-muted font-bold uppercase tracking-wider">Select Agreement Card</label>
                        <div className="flex flex-wrap gap-1.5">
                          {DECKS[deckStyle].map((card) => (
                            <button
                              key={card}
                              type="button"
                              onClick={() => setAcceptedValue(card)}
                              className={`px-2.5 py-1 border rounded text-[10px] font-extrabold transition-all hover:scale-[1.03] ${
                                acceptedValue === card
                                  ? 'theme-accent-bg text-[var(--bg-color)] border-[var(--accent-color)]'
                                  : 'bg-[var(--bg-color)] border-[var(--border-color)] text-[var(--text-color)] hover:theme-accent-border'
                              }`}
                            >
                              {card}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] theme-text-muted font-bold uppercase tracking-wider">Or, Enter Custom Override</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={acceptedValue}
                            onChange={(e) => setAcceptedValue(e.target.value)}
                            placeholder="e.g. 5, 8, 16k"
                            className="flex-1 px-3 py-2 bg-[var(--bg-color)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-color)] focus:outline-none focus:theme-accent-border"
                          />
                          <button
                            onClick={handleCompleteRound}
                            disabled={!acceptedValue}
                            className="px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold rounded-lg text-xs uppercase tracking-wider transition-colors"
                          >
                            Complete
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleResetRound}
                    disabled={!ticketTitle}
                    className="w-full py-2.5 bg-[var(--bg-color)] hover:opacity-80 border border-[var(--border-color)] theme-text-muted hover:theme-accent-text font-bold rounded-lg text-xs uppercase tracking-wider transition-all"
                  >
                    Reset Current Round
                  </button>

                  <button
                    onClick={handleEndSession}
                    className="w-full py-2.5 bg-rose-950/20 hover:bg-rose-900/30 border border-rose-900/30 text-rose-400 font-bold rounded-lg text-xs uppercase tracking-wider transition-all"
                  >
                    Close Session & End Room
                  </button>
                </div>
              </div>
            </div>

            {/* Right Panel: Game Board & Sessions Log */}
            <div className="lg:col-span-7 flex flex-col gap-6">
              
              {/* Estimation Board */}
              <div className="theme-card p-6 flex-1 flex flex-col justify-between">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider theme-text-muted border-b border-[var(--border-color)] pb-3 mb-5">
                    Active Poker Board
                  </h3>

                  {/* Results summaries */}
                  {revealed && (
                    <div className="grid grid-cols-2 gap-4 bg-[var(--bg-color)] border border-[var(--border-color)] p-4 rounded-xl mb-6 animate-fade-in">
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase tracking-wider theme-text-muted font-bold">Average Estimate:</span>
                        <span className="text-2xl font-extrabold theme-accent-text">{stats.average}</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase tracking-wider theme-text-muted font-bold">Consensus Model:</span>
                        <span className="text-2xl font-extrabold text-emerald-500">{stats.consensus}</span>
                      </div>
                    </div>
                  )}

                  {/* Participant Cards Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {votingEstimators.length === 0 && !inviteAI ? (
                      <div className="col-span-full text-center py-12 border border-dashed border-[var(--border-color)] rounded-xl">
                        <span className="text-xs theme-text-muted font-semibold italic">Waiting for players to connect...</span>
                      </div>
                    ) : (
                      votingEstimators.map((p) => (
                        <div key={p.presenceRef} className="flex flex-col items-center justify-center p-4 bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl relative">
                          <div className={`w-12 h-16 rounded-lg border flex items-center justify-center font-extrabold text-sm mb-3 transition-all ${
                            p.voteCast
                              ? revealed
                                ? 'bg-[var(--accent-color)] border-[var(--accent-color)] text-[var(--bg-color)]'
                                : 'bg-[var(--accent-glow)] border-[var(--accent-color)] theme-accent-text'
                              : 'bg-slate-900/10 border-dashed border-slate-700 text-slate-500'
                          }`}>
                            {revealed && p.voteCast ? p.voteValue : p.voteCast ? '✓' : '?'}
                          </div>

                          <span className="text-xs font-bold text-[var(--text-color)] truncate max-w-full">
                            {p.name}
                          </span>

                          {/* Factors Breakdown */}
                          {revealed && p.factors && (
                            <div className="mt-3 border-t border-[var(--border-color)] w-full pt-2 flex flex-col gap-1 text-[8px] theme-text-muted font-bold uppercase">
                              {TRACK_FACTORS[currentTrack].map(f => (
                                <div key={f.key} className="flex justify-between">
                                  <span>{f.label}:</span>
                                  <span className="text-[var(--text-color)]">{p.factors?.[f.key] || 3}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                    )}

                    {/* AI peer */}
                    {inviteAI && (
                      <div className="flex flex-col items-center justify-center p-4 bg-gradient-to-br from-violet-950/20 to-slate-950 border border-[var(--accent-color)]/20 rounded-xl relative">
                        <span className="absolute top-2 right-2 text-[8px] bg-violet-500/20 border border-violet-500/30 text-violet-300 font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider animate-pulse">
                          AI Companion
                        </span>

                        <div className={`w-12 h-16 rounded-lg border flex items-center justify-center font-extrabold text-sm mb-3 transition-all ${
                          isAiLoading 
                            ? 'bg-slate-900 border-slate-800 text-slate-500 animate-pulse'
                            : aiError
                              ? 'bg-rose-950/20 border-rose-900/50 text-rose-400'
                              : aiEstimate 
                                ? revealed
                                  ? 'bg-emerald-600 border-emerald-500 text-white shadow-md'
                                  : 'bg-violet-900/40 border-violet-500/50 text-violet-300'
                                : 'bg-slate-900/20 border-slate-900 border-dashed text-slate-600'
                        }`}>
                          {isAiLoading ? '...' : aiError ? '⚠️' : revealed && aiEstimate ? aiEstimate.card : aiEstimate ? '✓' : '?'}
                        </div>

                        {aiError && (
                          <span className="text-[8px] text-rose-400 font-bold uppercase tracking-wider mt-1 text-center">
                            Offline (Manual Mode)
                          </span>
                        )}

                        <span className="text-xs font-bold text-slate-300">
                          CogPoker AI
                        </span>

                        {revealed && aiEstimate && (
                          <div className="mt-3 border-t border-slate-900 w-full pt-2 flex flex-col gap-1 text-[8px] text-slate-500">
                            {TRACK_FACTORS[currentTrack].map(f => (
                              <div key={f.key} className="flex justify-between uppercase font-semibold">
                                <span>{f.label}:</span>
                                <span className="text-slate-300">{aiEstimate.factors[f.key] || 3}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Sizing Analytics Overlay */}
                {revealed && (
                  <SizingAnalytics
                    votingEstimators={votingEstimators}
                    aiEstimate={aiEstimate}
                    currentTrack={currentTrack}
                  />
                )}

                {/* Session History Log */}
                <div className="border-t border-[var(--border-color)] pt-6 mt-6">
                  <h3 className="text-xs font-bold uppercase tracking-wider theme-text-muted mb-3">
                    Completed Rounds History
                  </h3>
                  {roundsHistory.length === 0 ? (
                    <div className="text-center py-4 bg-[var(--bg-color)] border border-dashed border-[var(--border-color)] rounded-xl">
                      <span className="text-xs theme-text-muted italic">No rounds completed in this session yet.</span>
                    </div>
                  ) : (
                    <div className="max-h-[140px] overflow-y-auto flex flex-col gap-2 pr-1">
                      {roundsHistory.map((round) => (
                        <div key={round.id} className="bg-[var(--bg-color)] border border-[var(--border-color)] p-3 rounded-lg flex items-center justify-between gap-4">
                          <div className="truncate">
                            <h4 className="text-xs font-bold text-[var(--text-color)] truncate">{round.ticketTitle}</h4>
                            <span className="text-[9px] theme-text-muted uppercase font-bold tracking-wider">Track: {round.track} | Avg: {round.average}</span>
                          </div>
                          <span className="px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-extrabold rounded uppercase tracking-wider shrink-0">
                            {round.acceptedValue} PTS
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ========================================================================= */
          /* ESTIMATOR WORKSPACE                                                       */
          /* ========================================================================= */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch h-full animate-fade-in">
            {/* Left Panel: Ticket Context & Session History */}
            <div className="lg:col-span-4 flex flex-col gap-6">
              
              {/* Ticket Details Display */}
              <div className="theme-card p-6 flex flex-col gap-4">
                <h3 className="text-xs font-bold uppercase tracking-wider theme-text-muted border-b border-[var(--border-color)] pb-3">
                  {themeLabels.title} (Estimator)
                </h3>

                <div className="flex flex-col gap-2">
                  <h4 className="text-base font-extrabold text-[var(--text-color)]">{ticketTitle || 'Waiting for quest scroll...'}</h4>
                  <p className="text-sm theme-text-muted leading-relaxed mt-1 whitespace-pre-line">
                    {ticketDesc || 'Quest details will populate once the moderator broadcasts the update.'}
                  </p>
                </div>

                <div className="border-t border-[var(--border-color)] pt-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="theme-text-muted uppercase tracking-wider">Track:</span>
                    <span className="theme-accent-text uppercase tracking-widest">{currentTrack}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="theme-text-muted uppercase tracking-wider">AI peer status:</span>
                    <span className={`uppercase tracking-widest ${inviteAI ? 'text-emerald-400' : 'theme-text-muted'}`}>
                      {inviteAI ? 'summoned' : 'disabled'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Rounds History List */}
              <div className="theme-card p-6 flex-1 flex flex-col min-h-[200px]">
                <h3 className="text-xs font-bold uppercase tracking-wider theme-text-muted border-b border-[var(--border-color)] pb-3 mb-4">
                  Quest Log History
                </h3>
                {roundsHistory.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-center">
                    <span className="text-xs theme-text-muted font-semibold italic">No quests finished in this session.</span>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto max-h-[300px] flex flex-col gap-3 pr-1">
                    {roundsHistory.map((round) => (
                      <div key={round.id} className="bg-[var(--bg-color)] border border-[var(--border-color)] p-3 rounded-lg flex flex-col gap-1.5 hover:theme-accent-border transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-xs font-bold text-[var(--text-color)] truncate">{round.ticketTitle}</h4>
                          <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-extrabold px-2 py-0.5 rounded uppercase tracking-wider shrink-0">
                            {round.acceptedValue} PTS
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[9px] theme-text-muted font-bold uppercase tracking-wider">
                          <span>{round.track}</span>
                          <span>Avg: {round.average} | Consensus: {round.consensus}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel: Factor Sliders, Card Deck, and Poker Table */}
            <div className="lg:col-span-8 flex flex-col gap-6">
              
              {/* Factor Sliders */}
              <div className={`theme-card p-6 transition-all ${!ticketTitle ? 'opacity-40 pointer-events-none' : ''}`}>
                <h3 className="text-xs font-bold uppercase tracking-wider theme-text-muted border-b border-[var(--border-color)] pb-3 mb-5">
                  Factor Sizing Calculations
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                  {TRACK_FACTORS[currentTrack].map((f) => (
                    <div key={f.key} className="flex flex-col gap-2 animate-fade-in">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-[var(--text-color)]">{f.label}</span>
                        <span className="theme-accent-text font-bold">{(factors[f.key] !== undefined ? factors[f.key] : 3)} / 5</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="5"
                        disabled={selectedCard !== null}
                        value={factors[f.key] !== undefined ? factors[f.key] : 3}
                        onChange={(e) => handleFactorChange(f.key, parseInt(e.target.value))}
                        className="w-full accent-[var(--accent-color)] bg-[var(--bg-color)] h-2.5 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                      />
                      <div className="flex justify-between text-[9px] theme-text-muted font-semibold">
                        <span>{f.descMin}</span>
                        <span>{f.descMax}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 pt-5 border-t border-[var(--border-color)] flex items-center justify-between theme-accent-glow-bg p-4 rounded-xl border border-[var(--accent-color)]/10">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold text-[var(--text-color)]">Mathematical Recommendation:</span>
                    <span className="text-[10px] theme-text-muted">Composite thinking score: {calculateCompositeScore(currentTrack, factors).toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs theme-text-muted font-bold uppercase tracking-wider">Suggested Card:</span>
                    <span className="px-3.5 py-1.5 theme-accent-glow-bg border border-[var(--accent-color)]/20 rounded-lg text-sm font-extrabold theme-accent-text">
                      {recommendedCard}
                    </span>
                  </div>
                </div>
              </div>

              {/* Card Deck Selection */}
              <div className="theme-card p-6 relative">
                <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-3 mb-5">
                  <h3 className="text-xs font-bold uppercase tracking-wider theme-text-muted">
                    Cast Your Estimate
                  </h3>
                  {selectedCard && (
                    <span className="text-[10px] text-emerald-500 font-bold uppercase tracking-wider">
                      Vote Cast: Card {selectedCard} (Locked)
                    </span>
                  )}
                </div>

                {!ticketTitle && (
                  <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm rounded-xl flex items-center justify-center z-10 border border-slate-900">
                    <span className="text-slate-400 text-xs font-bold tracking-wide uppercase px-4 py-2 border border-slate-800 bg-slate-950 rounded-lg">
                      Waiting for host to set a ticket...
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-3">
                  {DECKS[deckStyle].map((card) => {
                    const isSelected = selectedCard === card;
                    const anyCardSelected = selectedCard !== null;
                    const isBtnDisabled = !ticketTitle || revealed || (anyCardSelected && !isSelected);

                    return (
                      <button
                        key={card}
                        onClick={() => handleCastCard(card)}
                        disabled={isBtnDisabled}
                        className={`aspect-[2/3] border rounded-xl flex items-center justify-center font-extrabold text-base transition-all hover:scale-105 ${
                          isSelected
                            ? 'theme-accent-bg text-[var(--bg-color)] border-[var(--accent-color)] shadow-md shadow-[var(--accent-color)]/10 scale-105'
                            : isBtnDisabled 
                              ? 'bg-slate-950/40 border-slate-900/50 text-slate-600 cursor-not-allowed opacity-50'
                              : 'bg-[var(--bg-color)] border-[var(--border-color)] text-[var(--text-color)] hover:theme-accent-border hover:theme-accent-text'
                        }`}
                      >
                        {card}
                      </button>
                    );
                  })}
                </div>

                {selectedCard !== null && !revealed && (
                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={() => setSelectedCard(null)}
                      className="text-xs bg-[var(--bg-color)] hover:opacity-85 border border-[var(--border-color)] text-[var(--text-color)] font-bold py-1.5 px-3.5 rounded-lg transition-all"
                    >
                      Change Vote
                    </button>
                  </div>
                )}
              </div>

              {/* Poker Board for players */}
              <div className="theme-card p-6">
                <h3 className="text-xs font-bold uppercase tracking-wider theme-text-muted border-b border-[var(--border-color)] pb-3 mb-5">
                  Active Poker Board
                </h3>

                {revealed && (
                  <div className="grid grid-cols-2 gap-4 bg-[var(--bg-color)] border border-[var(--border-color)] p-4 rounded-xl mb-6 animate-fade-in">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-wider theme-text-muted font-bold">Average Estimate:</span>
                      <span className="text-xl font-extrabold theme-accent-text">{stats.average}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-wider theme-text-muted font-bold">Consensus Mode:</span>
                      <span className="text-xl font-extrabold text-emerald-500">{stats.consensus}</span>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {votingEstimators.length === 0 && !inviteAI ? (
                    <div className="col-span-full text-center py-8">
                      <span className="text-xs theme-text-muted italic">Waiting for estimators to enter the room...</span>
                    </div>
                  ) : (
                    votingEstimators.map((p) => {
                      const isYou = p.userId === userId;
                      return (
                        <div key={p.presenceRef} className="flex flex-col items-center justify-center p-4 bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl relative">
                          <div className={`w-12 h-16 rounded-lg border flex items-center justify-center font-extrabold text-sm mb-3 transition-all ${
                            p.voteCast
                              ? revealed
                                ? 'theme-accent-bg border-[var(--accent-color)] text-[var(--bg-color)] shadow-sm'
                                : 'theme-accent-glow-bg border-[var(--accent-color)]/40 theme-accent-text'
                              : 'bg-slate-900/10 border-dashed border-slate-700 text-slate-500'
                          }`}>
                            {revealed && p.voteCast ? p.voteValue : p.voteCast ? '✓' : '?'}
                          </div>

                          <span className="text-xs font-bold text-[var(--text-color)] truncate max-w-full">
                            {p.name} {isYou ? '(You)' : ''}
                          </span>

                          {revealed && p.factors && (
                            <div className="mt-3 border-t border-[var(--border-color)] w-full pt-2 flex flex-col gap-1 text-[8px] theme-text-muted font-bold uppercase">
                              {TRACK_FACTORS[currentTrack].map(f => (
                                <div key={f.key} className="flex justify-between">
                                  <span>{f.label}:</span>
                                  <span className="text-[var(--text-color)]">{p.factors?.[f.key] || 3}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}

                  {inviteAI && (
                    <div className="flex flex-col items-center justify-center p-4 bg-gradient-to-br from-violet-950/20 to-slate-950 border border-[var(--accent-color)]/20 rounded-xl relative">
                      <span className="absolute top-2 right-2 text-[8px] bg-violet-500/20 border border-violet-500/30 text-violet-300 font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider animate-pulse">
                        AI Companion
                      </span>

                      <div className={`w-12 h-16 rounded-lg border flex items-center justify-center font-extrabold text-sm mb-3 transition-all ${
                        isAiLoading 
                          ? 'bg-slate-900 border-slate-800 text-slate-500 animate-pulse'
                          : aiError
                            ? 'bg-rose-950/20 border-rose-900/50 text-rose-400'
                            : aiEstimate 
                              ? revealed
                                ? 'bg-emerald-600 border-emerald-500 text-white shadow-md'
                                : 'bg-violet-900/40 border-violet-500/50 text-violet-300 shadow-md'
                              : 'bg-slate-900/20 border-slate-900 border-dashed text-slate-600'
                      }`}>
                        {isAiLoading ? '...' : aiError ? '⚠️' : revealed && aiEstimate ? aiEstimate.card : aiEstimate ? '✓' : '?'}
                      </div>

                      <span className="text-xs font-bold text-slate-300">
                        CogPoker AI
                      </span>

                      {aiError && (
                        <span className="text-[8px] text-rose-400 font-bold uppercase tracking-wider mt-1 text-center">
                          Offline (Manual Mode)
                        </span>
                      )}

                      {revealed && aiEstimate && (
                        <div className="mt-3 border-t border-slate-900 w-full pt-2 flex flex-col gap-1 text-[8px] text-slate-500">
                          {TRACK_FACTORS[currentTrack].map(f => (
                            <div key={f.key} className="flex justify-between uppercase font-semibold">
                              <span>{f.label}:</span>
                              <span className="text-slate-300">{aiEstimate.factors[f.key] || 3}</span>
                            </div>
                          ))}
                          <p className="text-[9px] text-slate-400 italic leading-relaxed mt-2 border-t border-slate-900/50 pt-1.5 text-center">
                            "{aiEstimate.reasoning}"
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Sizing Analytics Overlay */}
              {revealed && (
                <SizingAnalytics
                  votingEstimators={votingEstimators}
                  aiEstimate={aiEstimate}
                  currentTrack={currentTrack}
                />
              )}

            </div>
          </div>
        )}
      </main>

      {sessionEnded && (
        <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-center z-50 text-center p-6 animate-fade-in">
          <div className="theme-card p-8 max-w-sm flex flex-col items-center gap-4 text-[var(--text-color)]">
            <span className="theme-accent-text text-lg font-extrabold animate-pulse">
              {currentTheme === 'space' && '🌌 SESSION CLOSED'}
              {currentTheme === 'cyberpunk' && '🦾 CONNECTION TERMINATED'}
              {currentTheme === 'tavern' && '🍻 QUEST ARCHIVED'}
              {currentTheme === 'arcade' && '🕹️ GAME OVER'}
            </span>
            <p className="text-sm theme-text-muted font-bold tracking-wide">
              {currentTheme === 'space' && 'The Moderator has closed this workspace. Returning to command deck...'}
              {currentTheme === 'cyberpunk' && 'System operator terminated session. Disconnecting from net-grid...'}
              {currentTheme === 'tavern' && 'The Guildmaster ended the party contract. Returning to tavern entrance...'}
              {currentTheme === 'arcade' && 'Arcade machine session terminated. Returning to insert coins...'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// SIZING INSIGHTS & ANALYTICS COMPONENT
// =========================================================================
interface SizingAnalyticsProps {
  votingEstimators: Participant[];
  aiEstimate: AIEstimateResult | null;
  currentTrack: EstimationTrack;
}

function SizingAnalytics({ votingEstimators, aiEstimate, currentTrack }: SizingAnalyticsProps) {
  // 1. Calculate Consensus Rate (standard deviation mapped to percentage)
  const votes = votingEstimators
    .map(p => p.voteValue)
    .filter((v): v is string => !!v);
  
  if (aiEstimate?.card) {
    votes.push(aiEstimate.card);
  }

  let consensusPercentage = 100;
  if (currentTrack !== 'autonomous' && votes.length > 1) {
    const numericVotes = votes.map(v => parseFloat(v)).filter(n => !isNaN(n));
    if (numericVotes.length > 1) {
      const avg = numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length;
      const squareDiffs = numericVotes.map(v => Math.pow(v - avg, 2));
      const variance = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
      const stdDev = Math.sqrt(variance);
      consensusPercentage = Math.max(0, Math.min(100, Math.round(100 - (stdDev * 25))));
    }
  } else if (votes.length > 1) {
    const counts: Record<string, number> = {};
    votes.forEach(v => counts[v] = (counts[v] || 0) + 1);
    const maxCount = Math.max(...Object.values(counts));
    consensusPercentage = Math.round((maxCount / votes.length) * 100);
  }

  // 2. Calculate Average Sizing Factor Scores
  const factorDefinitions = TRACK_FACTORS[currentTrack];
  const factorAverages: Record<string, number> = {};
  
  const activeFactorsList = votingEstimators
    .map(p => p.factors)
    .filter((f): f is FactorScores => !!f);

  if (aiEstimate?.factors) {
    activeFactorsList.push(aiEstimate.factors);
  }

  factorDefinitions.forEach(def => {
    let sum = 0;
    let count = 0;
    activeFactorsList.forEach(f => {
      if (f[def.key] !== undefined) {
        sum += f[def.key];
        count++;
      }
    });
    factorAverages[def.key] = count > 0 ? parseFloat((sum / count).toFixed(1)) : 3;
  });

  // Find the highest rated factor (the bottleneck!)
  let criticalFactor = factorDefinitions[0];
  let maxAvg = 0;
  factorDefinitions.forEach(def => {
    const avg = factorAverages[def.key] || 0;
    if (avg > maxAvg) {
      maxAvg = avg;
      criticalFactor = def;
    }
  });

  // 3. AI vs Human Calibration
  let calibrationText = 'Waiting for calibration data...';
  let calibrationStatus: 'aligned' | 'warning' | 'neutral' = 'neutral';
  
  if (votingEstimators.length > 0 && aiEstimate?.card) {
    if (currentTrack !== 'autonomous') {
      const hVotes = votingEstimators.map(p => parseFloat(p.voteValue || '')).filter(n => !isNaN(n));
      const hAvg = hVotes.reduce((a, b) => a + b, 0) / hVotes.length;
      const aiVal = parseFloat(aiEstimate.card);
      const gap = Math.abs(hAvg - aiVal);
      if (gap <= 1.5) {
        calibrationText = `Highly Aligned (Human Avg: ${hAvg.toFixed(1)} vs AI: ${aiVal.toFixed(1)})`;
        calibrationStatus = 'aligned';
      } else {
        calibrationText = `High Variance Alert (Human Avg: ${hAvg.toFixed(1)} vs AI: ${aiVal.toFixed(1)})`;
        calibrationStatus = 'warning';
      }
    } else {
      const match = votingEstimators.some(p => p.voteValue === aiEstimate.card);
      if (match) {
        calibrationText = 'Aligned: AI card suggestions match estimator choices.';
        calibrationStatus = 'aligned';
      } else {
        calibrationText = 'Variance Alert: AI card suggestions differ from estimator cards.';
        calibrationStatus = 'warning';
      }
    }
  } else {
    calibrationText = 'Calibration active once human and AI votes are revealed.';
  }

  return (
    <div className="theme-card p-5 mt-6 animate-fade-in flex flex-col gap-5 bg-gradient-to-br from-slate-900/10 to-slate-950/20">
      <div className="border-b border-[var(--border-color)] pb-3 flex justify-between items-center">
        <h4 className="text-xs font-bold uppercase tracking-wider theme-text-muted">
          Sizing Insights & Analytics
        </h4>
        <span className="text-[10px] theme-accent-text font-bold uppercase tracking-widest bg-[var(--accent-glow)] px-2 py-0.5 border border-[var(--accent-color)]/20 rounded">
          Real-Time
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-stretch">
        
        {/* Consensus Meter */}
        <div className="md:col-span-4 flex flex-col justify-center items-center p-4 bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl text-center">
          <span className="text-[10px] theme-text-muted font-bold uppercase tracking-wider mb-2">Team Consensus Rate</span>
          <div className="relative w-20 h-20 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-4 border-[var(--border-color)] border-t-[var(--accent-color)] animate-spin-slow opacity-25" />
            <span className="text-2xl font-extrabold theme-accent-text">{consensusPercentage}%</span>
          </div>
          <p className="text-[9px] theme-text-muted mt-3 font-bold uppercase tracking-wider">
            {consensusPercentage >= 80 ? '🔥 Strong Agreement' : consensusPercentage >= 50 ? '⚡ Moderate Variance' : '⚠️ High Disagreement'}
          </p>
        </div>

        {/* Factors average list */}
        <div className="md:col-span-8 flex flex-col gap-3 justify-center">
          <span className="text-[10px] theme-text-muted font-bold uppercase tracking-wider border-b border-[var(--border-color)]/30 pb-1">
            Factor Uncertainty Levels (Averages)
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            {factorDefinitions.map(def => {
              const score = factorAverages[def.key] || 3;
              const percent = (score / 5) * 100;
              const isBottleneck = def.key === criticalFactor.key;
              return (
                <div key={def.key} className="flex flex-col gap-1">
                  <div className="flex justify-between items-center text-[10px] font-bold">
                    <span className={isBottleneck ? 'theme-accent-text' : 'text-slate-300'}>
                      {def.label} {isBottleneck ? '⚠️' : ''}
                    </span>
                    <span>{score} / 5</span>
                  </div>
                  <div className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] h-1.5 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all ${isBottleneck ? 'theme-accent-bg' : 'bg-slate-500/50'}`} 
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          
          <div className="text-[9px] bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 flex items-start gap-1.5 mt-1 font-semibold theme-text-muted uppercase tracking-wider">
            <span>Critical Bottleneck:</span>
            <span className="text-[var(--text-color)]">{criticalFactor.label} ({maxAvg}/5)</span>
          </div>
        </div>
      </div>

      {/* AI vs Human calibration indicator */}
      <div className="flex items-center gap-3 bg-[var(--bg-color)] border border-[var(--border-color)] p-3 rounded-lg text-xs font-bold">
        <span className="theme-text-muted uppercase tracking-wider">Calibration:</span>
        <span className={`px-2 py-0.5 rounded text-[10px] ${
          calibrationStatus === 'aligned' 
            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' 
            : calibrationStatus === 'warning'
              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
              : 'bg-slate-500/10 text-slate-400'
        }`}>
          {calibrationText}
        </span>
      </div>
    </div>
  );
}
