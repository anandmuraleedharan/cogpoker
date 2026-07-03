'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    // Pre-populate name if exists in localStorage
    const savedName = localStorage.getItem('cogpoker_username');
    if (savedName) setName(savedName);

    // Pre-populate room ID if in query params
    const roomParam = searchParams.get('room');
    if (roomParam) {
      setRoomId(roomParam);
      setIsJoining(true);
    }
  }, [searchParams]);

  const handleStart = (e: React.FormEvent, mode: 'create' | 'join') => {
    e.preventDefault();
    if (!name.trim()) return;

    localStorage.setItem('cogpoker_username', name.trim());
    
    const targetRoomId = mode === 'create' 
      ? Math.random().toString(36).substring(2, 9).toUpperCase() 
      : roomId.trim().toUpperCase();

    if (!targetRoomId) return;

    if (mode === 'create') {
      sessionStorage.setItem(`cogpoker_creator_${targetRoomId}`, 'true');
    }

    router.push(`/room/${targetRoomId}`);
  };

  return (
    <main className="w-full max-w-md bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-8 shadow-2xl relative z-10 flex flex-col gap-8 transition-all hover:border-slate-700/50">
      <header className="text-center">
        <div className="inline-flex items-center justify-center p-3 bg-violet-500/10 border border-violet-500/20 rounded-xl text-violet-400 mb-4 animate-pulse">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-violet-400 via-indigo-300 to-emerald-400 bg-clip-text text-transparent">
          CogPoker
        </h1>
        <p className="text-slate-400 text-sm mt-2 font-medium">
          AI-Era Story Pointing & Estimator
        </p>
      </header>

      <form className="flex flex-col gap-6" onSubmit={(e) => handleStart(e, isJoining ? 'join' : 'create')}>
        <div className="flex flex-col gap-2">
          <label htmlFor="display-name" className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
            Your Display Name
          </label>
          <input
            id="display-name"
            type="text"
            required
            placeholder="e.g. Anand, Sarah, Copilot"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl focus:outline-none focus:border-violet-500 text-slate-100 transition-colors placeholder:text-slate-600 font-medium"
          />
        </div>

        {isJoining ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="room-id" className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
              Room ID
            </label>
            <input
              id="room-id"
              type="text"
              required
              placeholder="e.g. AB4CD9E"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl focus:outline-none focus:border-violet-500 text-slate-100 uppercase tracking-widest transition-colors placeholder:text-slate-600 font-bold"
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-3 mt-2">
          <button
            type="submit"
            className="w-full py-3.5 px-4 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-violet-900/30 hover:shadow-violet-900/40 hover:-translate-y-0.5 active:translate-y-0 active:shadow-lg transition-all"
          >
            {isJoining ? 'Join Estimate Room' : 'Create New Room'}
          </button>

          <button
            type="button"
            onClick={() => setIsJoining(!isJoining)}
            className="text-xs text-slate-400 hover:text-slate-200 underline font-medium py-1 transition-colors"
          >
            {isJoining ? 'Or, create a new room instead' : 'Or, join an existing room with a Room ID'}
          </button>
        </div>
      </form>

      <footer className="border-t border-slate-800/80 pt-4 text-center">
        <p className="text-xs text-slate-500 leading-relaxed">
          "We no longer point coding; we point thinking."
        </p>
      </footer>
    </main>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background Gradients */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-violet-600/10 blur-[120px]" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-500/10 blur-[120px]" />

      <Suspense fallback={
        <div className="w-full max-w-md bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-8 shadow-2xl relative z-10 flex flex-col items-center justify-center min-h-[300px]">
          <span className="text-slate-400 text-sm animate-pulse font-medium">Initializing CogPoker...</span>
        </div>
      }>
        <HomeContent />
      </Suspense>
    </div>
  );
}
