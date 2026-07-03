export type ThemeName = 'space' | 'cyberpunk' | 'tavern' | 'arcade';

class SoundSynthesizer {
  private ctx: AudioContext | null = null;

  private initCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  private playTone(freqs: number[], durations: number[], type: OscillatorType, volume: number = 0.1) {
    try {
      const audioCtx = this.initCtx();
      let time = audioCtx.currentTime;

      freqs.forEach((freq, index) => {
        const duration = durations[index] || 0.1;
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, time);

        // Exponential volume decay
        gainNode.gain.setValueAtTime(volume, time);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, time + duration);

        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        osc.start(time);
        osc.stop(time + duration);

        time += duration * 0.8; // overlap slightly
      });
    } catch (err) {
      console.warn('Audio playback failed:', err);
    }
  }

  private playGlitch() {
    try {
      const audioCtx = this.initCtx();
      const bufferSize = audioCtx.sampleRate * 0.08; // 80ms
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      
      for (let i = 0; i < bufferSize; i++) {
        // Random white noise with filter step
        data[i] = (Math.random() * 2 - 1) * Math.sin(i * 0.05);
      }

      const noise = audioCtx.createBufferSource();
      noise.buffer = buffer;

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1000;

      const gainNode = audioCtx.createGain();
      gainNode.gain.setValueAtTime(0.05, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.08);

      noise.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      noise.start();
    } catch (err) {
      console.warn('Glitch audio failed:', err);
    }
  }

  public playVote(theme: ThemeName) {
    switch (theme) {
      case 'space':
        // High-tech spaceship diagnostic confirmation
        this.playTone([800, 1200], [0.08, 0.15], 'sine', 0.08);
        break;
      case 'cyberpunk':
        // Digital terminal click
        this.playTone([1600], [0.03], 'square', 0.05);
        break;
      case 'tavern':
        // Heavy wooden coin set down
        this.playTone([180, 120], [0.1, 0.15], 'triangle', 0.2);
        break;
      case 'arcade':
        // 8-bit coin jump
        this.playTone([523.25, 659.25], [0.07, 0.15], 'square', 0.05);
        break;
    }
  }

  public playReveal(theme: ThemeName) {
    switch (theme) {
      case 'space':
        // Subspace frequency reveal sweep
        try {
          const audioCtx = this.initCtx();
          const osc = audioCtx.createOscillator();
          const gainNode = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(300, audioCtx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.45);
          
          gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.45);
          
          osc.connect(gainNode);
          gainNode.connect(audioCtx.destination);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.45);
        } catch {}
        break;
      case 'cyberpunk':
        // Glitch network unlock
        this.playGlitch();
        break;
      case 'tavern':
        // Glass mugs clink / lute strum combo
        this.playTone([880, 1320, 1760], [0.08, 0.08, 0.2], 'sine', 0.07);
        break;
      case 'arcade':
        // Retro arcade stage clear chime
        this.playTone([587.33, 659.25, 698.46, 880], [0.08, 0.08, 0.08, 0.25], 'square', 0.05);
        break;
    }
  }

  public playComplete(theme: ThemeName) {
    switch (theme) {
      case 'space':
        // Command deck action completed chime
        this.playTone([600, 900, 1200], [0.1, 0.1, 0.3], 'sine', 0.08);
        break;
      case 'cyberpunk':
        // Success hack terminal sequence
        this.playTone([1000, 1500, 2000], [0.06, 0.06, 0.25], 'sawtooth', 0.04);
        break;
      case 'tavern':
        // Tavern celebration chord
        this.playTone([261.63, 329.63, 392.00, 523.25], [0.12, 0.12, 0.12, 0.4], 'triangle', 0.15);
        break;
      case 'arcade':
        // Level up/quest complete fanfare
        this.playTone([523.25, 659.25, 783.99, 1046.50], [0.08, 0.08, 0.08, 0.35], 'square', 0.05);
        break;
    }
  }

  public playReset(theme: ThemeName) {
    switch (theme) {
      case 'space':
        // Subspace reset frequency sweep
        try {
          const audioCtx = this.initCtx();
          const osc = audioCtx.createOscillator();
          const gainNode = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(800, audioCtx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(200, audioCtx.currentTime + 0.3);
          
          gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.3);
          
          osc.connect(gainNode);
          gainNode.connect(audioCtx.destination);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.3);
        } catch {}
        break;
      case 'cyberpunk':
        // System purge buzz
        this.playTone([120, 80], [0.1, 0.2], 'sawtooth', 0.08);
        break;
      case 'tavern':
        // Book closing / deep drum thud
        this.playTone([100], [0.35], 'sine', 0.25);
        break;
      case 'arcade':
        // Chiptune power down
        this.playTone([800, 600, 400, 200], [0.06, 0.06, 0.06, 0.15], 'square', 0.06);
        break;
    }
  }
}

export const audio = new SoundSynthesizer();
