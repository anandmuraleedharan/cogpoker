import { NextRequest, NextResponse } from 'next/server';

interface BroadcastEvent {
  id: string;
  event: string;
  payload?: any;
  senderId?: string;
  timestamp: number;
}

interface RoomState {
  presences: Record<string, { presence_ref: string; name: string; joinedAt: number; [key: string]: any }[]>;
  events: BroadcastEvent[];
}

// Global in-memory room states registry
const ROOMS: Record<string, RoomState> = {};

export async function POST(request: NextRequest) {
  try {
    const { action, roomId, userId, username, state, eventName, payload, lastTimestamp } = await request.json();

    if (!roomId) {
      return NextResponse.json({ error: 'roomId is required' }, { status: 400 });
    }

    // Initialize room state if missing
    if (!ROOMS[roomId]) {
      ROOMS[roomId] = {
        presences: {},
        events: []
      };
    }
    const room = ROOMS[roomId];

    if (action === 'track') {
      room.presences[userId] = [
        {
          presence_ref: `ref_${userId}`,
          name: username || '',
          joinedAt: Date.now(),
          ...state
        }
      ];
      return NextResponse.json({ success: true });
    }

    if (action === 'send') {
      const event: BroadcastEvent = {
        id: Math.random().toString(36).substring(2, 9),
        event: eventName,
        payload,
        senderId: userId,
        timestamp: Date.now()
      };
      room.events.push(event);
      // Keep only last 100 events to prevent memory bloating
      if (room.events.length > 100) {
        room.events.shift();
      }
      return NextResponse.json({ success: true });
    }

    if (action === 'poll') {
      // Find new events since lastTimestamp
      const newEvents = room.events.filter(e => e.timestamp > (Number(lastTimestamp) || 0));
      return NextResponse.json({
        presences: room.presences,
        events: newEvents,
        timestamp: Date.now()
      });
    }

    if (action === 'leave') {
      delete room.presences[userId];
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
