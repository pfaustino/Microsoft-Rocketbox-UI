import type { AnimationRecord, Gender, Motion } from './types';

export function rocketboxUrl(relativePath: string): string {
  return '/rocketbox/' + encodePath(relativePath);
}

export function textureUrl(characterId: string, file: string): string {
  return '/rocketbox-img/' + encodePath(`Assets/Avatars/${characterId}/Textures/${file}`) + '.png';
}

export function characterFbxPath(characterId: string, folder: string): string {
  return `Assets/Avatars/${characterId}/Export/${folder}.fbx`;
}

export function thumbnailPath(characterId: string, folder: string): string {
  return `Assets/Avatars/${characterId}/${folder}.png`;
}

function encodePath(relativePath: string): string {
  return relativePath.split('/').map(encodeURIComponent).join('/');
}

const motionFallback: Record<Motion, Motion[]> = {
  static: ['static', 'xy', 'xyz'],
  xy: ['xy', 'static', 'xyz'],
  xyz: ['xyz', 'xy', 'static'],
};

export type ResolvedClip = {
  path: string;
  motion: Motion;
  gender: Gender;
};

export function resolveAnimation(
  animation: AnimationRecord,
  gender: Gender,
  motion: Motion,
): ResolvedClip | null {
  const genders: Gender[] = gender === 'female' ? ['female', 'male'] : ['male', 'female'];
  for (const candidateMotion of motionFallback[motion]) {
    for (const candidateGender of genders) {
      const path = animation.motions[candidateMotion]?.[candidateGender];
      if (path) return { path, motion: candidateMotion, gender: candidateGender };
    }
  }
  return null;
}

export function motionLabel(motion: Motion): string {
  if (motion === 'xy') return 'ground path';
  if (motion === 'xyz') return 'full path';
  return 'in place';
}
