import { MOUTH_REST, type MouthShape } from './mouth';

// The dev server renders a real WAV with Windows speech, and Web Audio plays it.
// That sidesteps Chrome's broken speechSynthesis pipeline and gives us the exact
// clip length and playback clock, so the mouth matches the voice. If the server
// endpoint is absent (a static build), browser speech synthesis is the fallback.

type ShapeId = 'rest' | 'mbp' | 'ou' | 'ei' | 'aa' | 'fv' | 'ss' | 'stop' | 'nn';

type Phone = MouthShape & {
  id: ShapeId;
  phoneme: string;
  vowel: boolean;
  weight?: number;
};

type Cue = { t0: number; t1: number; shape: MouthShape };

const VOWELS = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW']);
const DIPHTHONG: Record<string, string[]> = {
  AY: ['AA', 'IH'],
  AW: ['AA', 'UW'],
  EY: ['EH', 'IY'],
  OW: ['AO', 'UW'],
  OY: ['AO', 'IY'],
};

const SHAPES: Record<ShapeId, MouthShape & { id: ShapeId }> = {
  rest: { id: 'rest', jaw: 0, round: 0, stretch: 0, close: 0 },
  mbp: { id: 'mbp', jaw: 0, round: 0.04, stretch: 0, close: 1 },
  ou: { id: 'ou', jaw: 0.4, round: 0.92, stretch: 0, close: 0 },
  ei: { id: 'ei', jaw: 0.28, round: 0, stretch: 0.88, close: 0 },
  aa: { id: 'aa', jaw: 0.82, round: 0.06, stretch: 0.12, close: 0 },
  fv: { id: 'fv', jaw: 0.08, round: 0, stretch: 0.22, close: 0.15 },
  ss: { id: 'ss', jaw: 0.06, round: 0.04, stretch: 0.3, close: 0 },
  stop: { id: 'stop', jaw: 0.05, round: 0, stretch: 0, close: 0.35 },
  nn: { id: 'nn', jaw: 0.16, round: 0, stretch: 0.1, close: 0 },
};

const PHONE_ID: Record<string, ShapeId> = {};
for (const phone of ['M', 'B', 'P']) PHONE_ID[phone] = 'mbp';
for (const phone of ['F', 'V']) PHONE_ID[phone] = 'fv';
for (const phone of ['AA', 'AE', 'AH']) PHONE_ID[phone] = 'aa';
for (const phone of ['AO', 'OW', 'UH', 'UW', 'W', 'ER', 'R']) PHONE_ID[phone] = 'ou';
for (const phone of ['EH', 'EY', 'IH', 'IY', 'Y']) PHONE_ID[phone] = 'ei';
for (const phone of ['S', 'Z', 'SH', 'ZH', 'TH', 'DH', 'CH', 'JH']) PHONE_ID[phone] = 'ss';
for (const phone of ['T', 'D', 'K', 'G']) PHONE_ID[phone] = 'stop';
for (const phone of ['L', 'N', 'NG', 'HH']) PHONE_ID[phone] = 'nn';

const TUNE: Record<string, Partial<MouthShape>> = {
  AO: { jaw: 0.46, round: 0.88 },
  OW: { jaw: 0.42, round: 0.9 },
  UW: { jaw: 0.16, round: 0.98 },
  UH: { jaw: 0.24, round: 0.86 },
  W: { jaw: 0.14, round: 0.96 },
  ER: { jaw: 0.28, round: 0.68 },
  R: { jaw: 0.2, round: 0.62 },
  EH: { jaw: 0.34, stretch: 0.8 },
  IH: { jaw: 0.24, stretch: 0.84 },
  IY: { jaw: 0.16, stretch: 0.95 },
  Y: { jaw: 0.14, stretch: 0.85 },
};

const LEXICON: Record<string, string> = {
  a: 'AH', i: 'AY', you: 'Y UW', the: 'DH AH', to: 'T UW', of: 'AH V', and: 'AE N D',
  is: 'IH Z', it: 'IH T', in: 'IH N', that: 'DH AE T', this: 'DH IH S', for: 'F AO R',
  with: 'W IH DH', on: 'AA N', be: 'B IY', are: 'AA R', was: 'W AH Z', were: 'W ER',
  have: 'HH AE V', has: 'HH AE Z', had: 'HH AE D', not: 'N AA T', but: 'B AH T',
  what: 'W AH T', when: 'W EH N', where: 'W EH R', who: 'HH UW', how: 'HH AW', why: 'W AY',
  she: 'SH IY', he: 'HH IY', her: 'HH ER', his: 'HH IH Z', they: 'DH EY', we: 'W IY',
  me: 'M IY', my: 'M AY', your: 'Y AO R', do: 'D UW', dont: 'D OW N T', "don't": 'D OW N T',
  know: 'N OW', go: 'G OW', see: 'S IY', say: 'S EY', said: 'S EH D', like: 'L AY K',
  just: 'JH AH S T', about: 'AH B AW T', there: 'DH EH R', their: 'DH EH R', from: 'F R AH M',
  or: 'AO R', one: 'W AH N', would: 'W UH D', could: 'K UH D', should: 'SH UH D',
  people: 'P IY P AH L', think: 'TH IH NG K', hello: 'HH AH L OW', hi: 'HH AY',
  yes: 'Y EH S', no: 'N OW', okay: 'OW K EY', ok: 'OW K EY', mom: 'M AA M', papa: 'P AA P AH',
  boat: 'B OW T', love: 'L AH V', tone: 'T OW N',
};

const REST: Phone = { ...SHAPES.rest, phoneme: 'sil', vowel: false };
const FADE = 0.05;

export class Speaker<T extends object = object> {
  target: T | null = null;
  speaking = false;
  onBlocked: (message: string) => void = () => {};

  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private controller: AbortController | null = null;
  private generation = 0;
  private phones: Phone[] = [];
  private cues: Cue[] = [];
  private clipStart = 0;
  private clipDuration = 0;
  private fallbackStart = 0;
  private mode: 'loading' | 'audio' | 'fallback' = 'loading';
  private utterance: SpeechSynthesisUtterance | null = null;

  say(target: T, text: string, gender: 'female' | 'male'): 'audio' | 'silent' {
    this.stop();
    const gen = this.generation;
    this.phones = textToPhonemes(text);
    this.cues = layout(this.phones);
    this.clipDuration = this.cues.length ? this.cues[this.cues.length - 1].t1 : 0.4;
    this.target = target;
    this.speaking = true;
    this.mode = 'loading';

    // Unlock the AudioContext while the Send click is still active.
    const ctx = this.ensureContext();
    if (ctx?.state === 'suspended') void ctx.resume();

    const controller = new AbortController();
    this.controller = controller;
    void this.playServerWav(text, gender, gen, controller.signal);
    return ctx || typeof window.speechSynthesis !== 'undefined' ? 'audio' : 'silent';
  }

  stop() {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        // Already stopped.
      }
      this.source.disconnect();
      this.source = null;
    }
    this.utterance = null;
    window.speechSynthesis?.cancel();
    this.speaking = false;
    this.target = null;
  }

  sample(now = performance.now()): MouthShape | null {
    if (!this.speaking) return null;
    if (this.mode === 'loading') return MOUTH_REST;
    const elapsed = this.mode === 'audio' && this.context
      ? this.context.currentTime - this.clipStart
      : (now - this.fallbackStart) / 1000;
    if (elapsed >= this.clipDuration + FADE) {
      if (this.mode === 'fallback') this.finish();
      return MOUTH_REST;
    }
    return shapeAt(this.cues, elapsed);
  }

  private async playServerWav(text: string, gender: 'female' | 'male', gen: number, signal: AbortSignal) {
    const ctx = this.ensureContext();
    try {
      if (!ctx) throw new Error('No Web Audio');
      const query = new URLSearchParams({ text, gender });
      const response = await fetch(`/rocketbox-tts?${query}`, { signal });
      if (!response.ok) throw new Error(`TTS ${response.status}`);
      const bytes = await response.arrayBuffer();
      if (gen !== this.generation) return;
      if (ctx.state === 'suspended') await ctx.resume();
      const buffer = await ctx.decodeAudioData(bytes);
      if (gen !== this.generation) return;
      const span = voiceSpan(buffer);
      this.cues = layout(this.phones, span.start, span.end);
      this.clipDuration = buffer.duration;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => {
        if (gen === this.generation) this.finish();
      };
      this.source = source;
      this.clipStart = ctx.currentTime;
      this.mode = 'audio';
      source.start();
    } catch {
      if (signal.aborted || gen !== this.generation) return;
      this.playBrowserFallback(text, gender, gen);
    }
  }

  private playBrowserFallback(text: string, gender: 'female' | 'male', gen: number) {
    this.fallbackStart = performance.now();
    this.mode = 'fallback';
    const synth = window.speechSynthesis;
    if (!synth) return;
    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(gender);
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
    } else {
      utter.lang = 'en-US';
    }
    utter.onstart = () => {
      if (gen === this.generation) this.fallbackStart = performance.now();
    };
    utter.onend = () => {
      if (gen === this.generation) this.finish();
    };
    utter.onerror = () => {
      if (gen !== this.generation) return;
      this.onBlocked('Could not play audio for that line. The mouth still moves.');
    };
    this.utterance = utter;
    synth.speak(utter);
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    if (typeof AudioContext === 'undefined') return null;
    this.context = new AudioContext();
    return this.context;
  }

  private finish() {
    this.source = null;
    this.controller = null;
    this.utterance = null;
    this.speaking = false;
    this.target = null;
  }
}

export function primeSpeech() {
  const synth = window.speechSynthesis;
  if (!synth) return;
  const load = () => {
    synth.getVoices();
  };
  load();
  synth.addEventListener('voiceschanged', load);
}

function voiceSpan(buffer: AudioBuffer): { start: number; end: number } {
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(buffer.sampleRate * 0.01));
  let first = -1;
  let last = -1;
  for (let i = 0; i < data.length; i += step) {
    let sum = 0;
    const stop = Math.min(data.length, i + step);
    for (let j = i; j < stop; j += 1) sum += data[j] * data[j];
    if (Math.sqrt(sum / (stop - i)) > 0.01) {
      if (first === -1) first = i;
      last = stop;
    }
  }
  if (first === -1 || last - first < buffer.sampleRate * 0.08) {
    return { start: 0, end: buffer.duration };
  }
  return {
    start: Math.max(0, first / buffer.sampleRate - 0.02),
    end: Math.min(buffer.duration, last / buffer.sampleRate + 0.03),
  };
}

function textToPhonemes(text: string): Phone[] {
  const parts = text.toLowerCase().match(/[a-z']+|[^a-z\s]+/g) ?? [];
  const phones: Phone[] = [];
  for (const part of parts) {
    if (/[a-z]/.test(part)) {
      if (phones.length) phones.push({ ...REST, weight: 0.28 });
      for (const phoneme of spell(part)) {
        for (const piece of DIPHTHONG[phoneme] ?? [phoneme]) phones.push(shapeFor(piece));
      }
    } else if (/[.!?]/.test(part)) phones.push({ ...REST, weight: 1.1 });
    else if (/[,;:]/.test(part)) phones.push({ ...REST, weight: 0.55 });
  }
  return phones;
}

function shapeFor(phoneme: string): Phone {
  const id = PHONE_ID[phoneme] ?? 'rest';
  return { ...SHAPES[id], ...(TUNE[phoneme] ?? {}), phoneme, vowel: VOWELS.has(phoneme) };
}

function layout(phones: Phone[], start = 0, end?: number): Cue[] {
  const weights = phones.map(phoneWeight);
  const natural = Math.max(0.35, weights.reduce((total, weight) => total + weight * 0.13, 0));
  const span = Math.max(0.12, (end ?? start + natural) - start);
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let cursor = start;
  return phones.map((phone, index) => {
    const width = (weights[index] / total) * span;
    const cue = { t0: cursor, t1: cursor + width, shape: phone };
    cursor += width;
    return cue;
  });
}

function shapeAt(cues: Cue[], time: number): MouthShape {
  if (cues.length === 0) return MOUTH_REST;
  const head = cues[0].t0;
  const tail = cues[cues.length - 1].t1;
  if (time <= head - FADE || time >= tail + FADE) return MOUTH_REST;
  let shape: MouthShape = MOUTH_REST;
  if (time < head) return mix(MOUTH_REST, cues[0].shape, 1 - (head - time) / FADE);
  if (time > tail) return mix(cues[cues.length - 1].shape, MOUTH_REST, (time - tail) / FADE);
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    if (time < cue.t0) break;
    if (time > cue.t1) continue;
    shape = cue.shape;
    const next = cues[index + 1];
    if (next && cue.t1 - time < FADE) shape = mix(cue.shape, next.shape, 1 - (cue.t1 - time) / FADE);
    break;
  }
  return shape;
}

function mix(a: MouthShape, b: MouthShape, amount: number): MouthShape {
  const t = amount < 0 ? 0 : amount > 1 ? 1 : amount;
  return {
    jaw: a.jaw + (b.jaw - a.jaw) * t,
    round: a.round + (b.round - a.round) * t,
    stretch: a.stretch + (b.stretch - a.stretch) * t,
    close: a.close + (b.close - a.close) * t,
  };
}

function phoneWeight(phone: Phone): number {
  if (phone.weight) return phone.weight;
  if (phone.phoneme === 'sil') return 0.8;
  if (phone.vowel) return 1.15;
  if (phone.id === 'mbp' || phone.id === 'nn') return 0.62;
  if (phone.id === 'ss' || phone.id === 'fv') return 0.55;
  if (phone.id === 'stop') return 0.4;
  return 0.6;
}

function spell(word: string): string[] {
  const raw = word.toLowerCase();
  if (LEXICON[raw]) return LEXICON[raw].split(' ');
  const stripped = raw.replace(/'/g, '');
  if (LEXICON[stripped]) return LEXICON[stripped].split(' ');
  const out: string[] = [];
  let i = 0;
  const take = (count: number, phones: string[]) => {
    i += count;
    out.push(...phones);
  };
  while (i < stripped.length) {
    const slice = stripped.slice(i);
    if (slice.startsWith('tion')) { take(4, ['SH', 'AH', 'N']); continue; }
    if (slice.startsWith('sion')) { take(4, ['ZH', 'AH', 'N']); continue; }
    if (slice.startsWith('ough')) { take(4, ['AO']); continue; }
    if (slice.startsWith('eigh')) { take(4, ['EY']); continue; }
    if (slice.startsWith('igh')) { take(3, ['AY']); continue; }
    if (slice.startsWith('qu')) { take(2, ['K', 'W']); continue; }
    if (slice.startsWith('ch')) { take(2, ['CH']); continue; }
    if (slice.startsWith('sh')) { take(2, ['SH']); continue; }
    if (slice.startsWith('th')) { take(2, ['TH']); continue; }
    if (slice.startsWith('ph')) { take(2, ['F']); continue; }
    if (slice.startsWith('wh')) { take(2, ['W']); continue; }
    if (slice.startsWith('ck')) { take(2, ['K']); continue; }
    if (slice.startsWith('ng')) { take(2, ['NG']); continue; }
    if (slice.startsWith('ee') || slice.startsWith('ea')) { take(2, ['IY']); continue; }
    if (slice.startsWith('oo')) { take(2, ['UW']); continue; }
    if (slice.startsWith('oa')) { take(2, ['OW']); continue; }
    if (slice.startsWith('ai') || slice.startsWith('ay')) { take(2, ['EY']); continue; }
    if (slice.startsWith('oi') || slice.startsWith('oy')) { take(2, ['OY']); continue; }
    if (slice.startsWith('ou') || slice.startsWith('ow')) { take(2, ['AW']); continue; }
    if (slice.startsWith('au') || slice.startsWith('aw')) { take(2, ['AO']); continue; }
    if (slice === 'ie') { take(2, ['AY']); continue; }
    if (slice.startsWith('ie')) { take(2, ['IY']); continue; }
    const magic = 'aeiou'.includes(slice[0])
      && stripped.length === i + 3
      && 'bcdfghjklmnpqrstvwxyz'.includes(slice[1])
      && slice[2] === 'e';
    if (magic) {
      const long: Record<string, string> = { a: 'EY', e: 'IY', i: 'AY', o: 'OW', u: 'UW' };
      take(3, [long[slice[0]], ...consonant(slice[1], '')]);
      continue;
    }
    if ('aeiou'.includes(slice[0])) {
      const short: Record<string, string> = { a: 'AE', e: 'EH', i: 'IH', o: 'AA', u: 'AH' };
      take(1, [short[slice[0]]]);
      continue;
    }
    if (slice[0] === 'y') { take(1, ['IY']); continue; }
    if (i > 0 && slice[0] === stripped[i - 1] && !'aeiou'.includes(slice[0])) { i += 1; continue; }
    const phones = consonant(slice[0], slice[1] ?? '');
    if (phones.length) { take(1, phones); continue; }
    i += 1;
  }
  return out;
}

function consonant(letter: string, next: string): string[] {
  const soft = 'eiy'.includes(next);
  switch (letter) {
    case 'b': return ['B'];
    case 'c': return [soft ? 'S' : 'K'];
    case 'd': return ['D'];
    case 'f': return ['F'];
    case 'g': return [soft ? 'JH' : 'G'];
    case 'h': return ['HH'];
    case 'j': return ['JH'];
    case 'k': return ['K'];
    case 'l': return ['L'];
    case 'm': return ['M'];
    case 'n': return ['N'];
    case 'p': return ['P'];
    case 'q': return ['K'];
    case 'r': return ['R'];
    case 's': return ['S'];
    case 't': return ['T'];
    case 'v': return ['V'];
    case 'w': return ['W'];
    case 'x': return ['K', 'S'];
    case 'y': return ['Y'];
    case 'z': return ['Z'];
    default: return [];
  }
}

function pickVoice(gender: 'female' | 'male'): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices().filter((voice) => voice.localService && !/google/i.test(voice.name));
  const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith('en'));
  const pool = english.length ? english : voices;
  if (pool.length === 0) return null;
  const want = gender === 'female'
    ? /zira|samantha|victoria|aria|jenny|female|woman/i
    : /david|mark|guy|daniel|male/i;
  return pool.find((voice) => want.test(voice.name)) ?? pool[0];
}
