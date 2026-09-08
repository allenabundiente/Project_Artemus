// Tiny WebAudio chiptune SFX. Lazy-inits on first user gesture; mute state
// persists in localStorage. All sounds are synthesized — no audio files needed.

let ctx: AudioContext | null = null;
let muted = typeof localStorage !== 'undefined' && localStorage.getItem('arcade-muted') === '1';

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(
  freqFrom: number,
  freqTo: number,
  dur: number,
  type: OscillatorType = 'square',
  vol = 0.06,
  delay = 0
): void {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqFrom, t0);
  if (freqTo !== freqFrom) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  isMuted(): boolean {
    return muted;
  },
  toggle(): boolean {
    muted = !muted;
    localStorage.setItem('arcade-muted', muted ? '1' : '0');
    return muted;
  },
  jump(): void {
    tone(320, 540, 0.09);
  },
  coin(): void {
    tone(880, 880, 0.06);
    tone(1320, 1320, 0.1, 'square', 0.06, 0.06);
  },
  hit(): void {
    tone(220, 70, 0.18, 'sawtooth', 0.08);
  },
  slash(): void {
    tone(900, 180, 0.12, 'triangle', 0.09);
  },
  select(): void {
    tone(660, 660, 0.05);
  },
  victory(): void {
    tone(523, 523, 0.09, 'square', 0.07, 0);
    tone(659, 659, 0.09, 'square', 0.07, 0.09);
    tone(784, 784, 0.09, 'square', 0.07, 0.18);
    tone(1047, 1047, 0.18, 'square', 0.07, 0.27);
  },
  defeat(): void {
    tone(392, 392, 0.12, 'square', 0.07, 0);
    tone(330, 330, 0.12, 'square', 0.07, 0.12);
    tone(262, 262, 0.24, 'square', 0.07, 0.24);
  },
  bossRoar(): void {
    tone(120, 60, 0.5, 'sawtooth', 0.09);
    tone(90, 45, 0.6, 'square', 0.06, 0.1);
  },
};