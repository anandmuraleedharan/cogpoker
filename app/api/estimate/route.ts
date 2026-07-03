import { NextRequest, NextResponse } from 'next/server';
import { generateAIEstimate } from '@/lib/gemini';
import { EstimationTrack, DeckStyle } from '@/lib/estimation';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, track, deckStyle } = body;

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const validTracks: EstimationTrack[] = ['human', 'hybrid', 'autonomous'];
    if (!track || !validTracks.includes(track as EstimationTrack)) {
      return NextResponse.json({ error: 'Valid track is required (human, hybrid, or autonomous)' }, { status: 400 });
    }

    const estimate = await generateAIEstimate(
      title,
      description || '',
      track as EstimationTrack,
      (deckStyle as DeckStyle) || 'scrum'
    );
    return NextResponse.json(estimate);
  } catch (err: any) {
    console.error('AI Estimation Route Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
