import { animationsById } from './catalog';
import type { Gender } from './types';

// Keyword hits pick a Gestic Talk clip. Earlier moods win a tie. Neutral is the
// fallback, and only in-place files are used when this character has one.

type TalkMood = 'angry' | 'sad' | 'nervous' | 'excited' | 'assured' | 'cool' | 'relaxed' | 'neutral';

const RULES: { mood: TalkMood; source: string }[] = [
  { mood: 'angry', source: String.raw`\b(angry|anger|mad|furious|hate|hates|stupid|damn|hell|annoying|idiot|terrible|awful|worst|rage|pissed|outraged)\b` },
  { mood: 'sad', source: String.raw`\b(sad|sorry|miss|missed|lonely|cry|crying|grief|depressed|unhappy|heartbroken|unfortunately|died|dead|mourning)\b` },
  { mood: 'nervous', source: String.raw`\b(nervous|worried|worry|anxious|anxiety|scared|afraid|fear|unsure|stress|stressed|panic|uh+|um+)\b` },
  { mood: 'excited', source: String.raw`\b(excited|amazing|awesome|wow|yay|love|loved|great|fantastic|wonderful|happy|haha|lol|incredible|beautiful|hilarious)\b|!{2,}` },
  { mood: 'assured', source: String.raw`\b(confident|definitely|absolutely|of course|trust me|believe me|obviously|exactly|certain)\b` },
  { mood: 'cool', source: String.raw`\b(cool|smooth|slick)\b` },
  { mood: 'relaxed', source: String.raw`\b(relax|relaxed|calm|chill|peaceful|no worries)\b` },
];

const CLIPS: Record<TalkMood, string[]> = {
  angry: ['gestic_talk_angry_01', 'gestic_talk_angry_02'],
  sad: ['gestic_talk_sad_01'],
  nervous: ['gestic_talk_nervous_01', 'gestic_talk_nervous_02', 'gestic_talk_femalestressed_01'],
  excited: ['gestic_talk_excited_01', 'gestic_talk_excited_02'],
  assured: ['gestic_talk_self-assured_01', 'gestic_talk_self-assured_02', 'gestic_talk_self_assured_01', 'gestic_talk_self_assured_02'],
  cool: ['gestic_talk_cool'],
  relaxed: ['gestic_talk_relaxed_01', 'gestic_talk_relaxed_02'],
  neutral: ['gestic_talk_neutral_01', 'gestic_talk_neutral_02', 'gestic_talk_neutral_03'],
};

const cursor: Partial<Record<TalkMood, number>> = {};

export function chooseTalkGesture(text: string, gender: Gender): { id: string; label: string } {
  const mood = moodFor(text);
  const id = pick(mood, gender);
  return { id, label: animationsById.get(id)?.label ?? id };
}

function moodFor(text: string): TalkMood {
  let best: TalkMood = 'neutral';
  let bestScore = 0;
  for (const rule of RULES) {
    const score = text.match(new RegExp(rule.source, 'gi'))?.length ?? 0;
    if (score > bestScore) {
      best = rule.mood;
      bestScore = score;
    }
  }
  return best;
}

function pick(mood: TalkMood, gender: Gender): string {
  const ids = CLIPS[mood].filter((id) => animationsById.has(id));
  const own = (id: string) => {
    const motions = animationsById.get(id)?.motions;
    return Boolean(motions?.static?.[gender] || motions?.xy?.[gender] || motions?.xyz?.[gender]);
  };
  const available = ids.filter(own);
  const pool = available.length ? available : ids;
  const still = pool.filter((id) => animationsById.get(id)?.motions.static?.[gender]);
  const choices = still.length ? still : pool;
  const index = cursor[mood] ?? 0;
  cursor[mood] = index + 1;
  return choices[index % Math.max(1, choices.length)] ?? 'gestic_talk_neutral_01';
}
