export type Gender = 'female' | 'male';
export type Category = 'Adults' | 'Children' | 'Professions';
export type Motion = 'static' | 'xy' | 'xyz';

export type CharacterRecord = {
  id: string;
  name: string;
  folder: string;
  category: Category;
  gender: Gender;
  textures: string[];
};

export type AnimationRecord = {
  id: string;
  label: string;
  group: string;
  motions: Partial<Record<Motion, Partial<Record<Gender, string>>>>;
};

export type Catalog = {
  source: string;
  characters: CharacterRecord[];
  animations: AnimationRecord[];
};
