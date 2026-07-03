import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase URL or Anon Key environment variables are missing.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

// =========================================================================
// Playwright/Local Testing: API-based Polling Realtime channel mock provider
// =========================================================================

class MockRealtimeChannel {
  private roomId: string;
  private userId: string;
  private username: string = '';
  private intervalId: any = null;
  private lastTimestamp: number = 0;
  private localPresences: Record<string, any> = {};
  private listeners: { type: string, event: string, cb: Function }[] = [];
  private lastTrackedState: any = null;
  private lastPresencesStr: string = '';

  constructor(channelName: string, userId: string) {
    this.roomId = channelName.replace('room-', '');
    this.userId = userId;
    this.lastTimestamp = Date.now();
  }

  on(type: string, filter: { event: string }, cb: Function) {
    this.listeners.push({ type, event: filter.event, cb });
    return this;
  }

  async subscribe(cb?: (status: string) => void) {
    if (cb) setTimeout(() => cb('SUBSCRIBED'), 0);

    // Poll the Next.js memory API every 200ms
    this.intervalId = setInterval(async () => {
      try {
        const res = await fetch('/api/realtime', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'poll',
            roomId: this.roomId,
            lastTimestamp: this.lastTimestamp
          })
        });
        if (res.ok) {
          const data = await res.json();
          this.lastTimestamp = data.timestamp;
          const presencesStr = JSON.stringify(data.presences);
          const hasChanged = presencesStr !== this.lastPresencesStr;

          if (hasChanged) {
            this.localPresences = data.presences;
            this.lastPresencesStr = presencesStr;

            // Trigger presence sync listeners only when state actually changed
            this.listeners
              .filter(l => l.type === 'presence' && l.event === 'sync')
              .forEach(l => l.cb());
          }

          // Self-healing synchronization:
          // Check if the server's presence for our userId matches our last tracked state.
          // If mismatch or missing, re-track to ensure state convergence.
          if (this.username) {
            const myServerPresenceArray = data.presences[this.userId];
            const myServerPresence = myServerPresenceArray?.[myServerPresenceArray.length - 1];

            const serverVoteCast = myServerPresence?.voteCast || false;
            const serverVoteValue = myServerPresence?.voteValue || null;
            const localVoteCast = this.lastTrackedState?.voteCast || false;
            const localVoteValue = this.lastTrackedState?.voteValue || null;

            if (!myServerPresence || serverVoteCast !== localVoteCast || serverVoteValue !== localVoteValue) {
              console.log(`[SUPABASE MOCK] Server presence out of sync for ${this.username}. Self-healing...`);
              this.track(this.lastTrackedState).catch(() => {});
            }
          }

          // Dispatch broadcast messages
          if (data.events && data.events.length > 0) {
            data.events.forEach((evt: any) => {
              // Ignore broadcast messages sent by this client itself (matching Supabase behavior)
              if (evt.senderId !== this.userId) {
                this.listeners
                  .filter(l => l.type === 'broadcast' && l.event === evt.event)
                  .forEach(l => l.cb({ payload: evt.payload }));
              }
            });
          }
        }
      } catch (e) {
        console.error('Realtime polling error:', e);
      }
    }, 200);

    return this;
  }

  async track(state: any) {
    this.username = state.name;
    this.lastTrackedState = state;
    try {
      await fetch('/api/realtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'track',
          roomId: this.roomId,
          userId: this.userId,
          username: this.username,
          state
        })
      });
    } catch (e) {}
  }

  presenceState() {
    return this.localPresences;
  }

  async send(data: { type: string, event: string, payload?: any }) {
    try {
      await fetch('/api/realtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          roomId: this.roomId,
          userId: this.userId,
          eventName: data.event,
          payload: data.payload
        })
      });
    } catch (e) {}
    return 'ok';
  }

  unsubscribe() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    fetch('/api/realtime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'leave',
        roomId: this.roomId,
        userId: this.userId
      })
    }).catch(() => {});
  }
}

const isMockRealtime = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || 
   window.location.hostname === '127.0.0.1' ||
   process.env.NEXT_PUBLIC_MOCK_REALTIME === 'true');

if (isMockRealtime) {
  console.log('[SUPABASE] Local/test environment detected. Mocking realtime channels using Next.js memory API polling.');
  (supabase as any).channel = (channelName: string, config?: any) => {
    const userId = config?.config?.presence?.key || Math.random().toString();
    return new MockRealtimeChannel(channelName, userId);
  };
}
