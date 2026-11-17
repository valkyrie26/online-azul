// Small synthesised sound effects (no audio files needed). Everything is built
// from oscillators and filtered noise so the game stays a single static site.

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem('azul-sound') !== 'off';
    // Browsers only allow audio after a user gesture; remember when we got one.
    this.unlocked = false;
    const unlock = () => {
      this.unlocked = true;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  get context() {
    if (!this.unlocked) return null;
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = Ctx ? new Ctx() : null;
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setEnabled(on) {
    this.enabled = on;
    localStorage.setItem('azul-sound', on ? 'on' : 'off');
  }

  tone(freq, { duration = 0.12, type = 'sine', gain = 0.12, delay = 0, slide = 0 } = {}) {
    if (!this.enabled) return;
    const ctx = this.context;
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + duration);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  click(freq = 1800, duration = 0.05, gain = 0.08) {
    if (!this.enabled) return;
    const ctx = this.context;
    if (!ctx) return;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 1.2;
    const amp = ctx.createGain();
    amp.gain.value = gain;
    src.connect(filter).connect(amp).connect(ctx.destination);
    src.start();
  }

  select() {
    this.click(2400, 0.04, 0.07);
    this.tone(660, { duration: 0.08, gain: 0.05 });
  }

  place() {
    this.click(900, 0.08, 0.12);
    this.tone(220, { duration: 0.1, gain: 0.06, type: 'triangle' });
  }

  slide() {
    this.click(1400, 0.05, 0.05);
  }

  score(points = 1) {
    const base = 523;
    const n = Math.min(5, Math.max(1, points));
    for (let i = 0; i < n; i++) this.tone(base * Math.pow(2, i / 12 * 2), { duration: 0.14, gain: 0.07, delay: i * 0.06 });
  }

  penalty() {
    this.tone(180, { duration: 0.25, gain: 0.08, type: 'sawtooth', slide: -80 });
  }

  error() {
    this.tone(140, { duration: 0.12, gain: 0.06, type: 'square' });
  }

  fanfare() {
    [0, 4, 7, 12, 16].forEach((semi, i) =>
      this.tone(440 * Math.pow(2, semi / 12), { duration: 0.35, gain: 0.08, delay: i * 0.11, type: 'triangle' }),
    );
  }

  roundEnd() {
    [0, 5, 9].forEach((semi, i) => this.tone(392 * Math.pow(2, semi / 12), { duration: 0.3, gain: 0.06, delay: i * 0.1 }));
  }
}
