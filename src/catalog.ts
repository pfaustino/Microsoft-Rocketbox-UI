import catalogJson from './data/catalog.json';
import type { AnimationRecord, Catalog, CharacterRecord } from './types';

export const catalog = catalogJson as Catalog;

export const charactersById = new Map<string, CharacterRecord>(
  catalog.characters.map((character) => [character.id, character]),
);

export const animationsById = new Map<string, AnimationRecord>(
  catalog.animations.map((animation) => [animation.id, animation]),
);
