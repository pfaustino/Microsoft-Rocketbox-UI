import { readFileSync } from 'node:fs';
import { decodeTga, tgaToPng } from '../server/tga.mjs';

const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url)));
const characters = catalog.characters;
const animations = catalog.animations;
if (characters.length !== 115) throw new Error(`expected 115 characters, got ${characters.length}`);

const ids = new Set();
const counts = { Adults: 0, Children: 0, Professions: 0 };
for (const character of characters) {
  if (ids.has(character.id)) throw new Error(`duplicate ${character.id}`);
  ids.add(character.id);
  if (character.gender !== 'female' && character.gender !== 'male') throw new Error(`gender ${character.id}`);
  if (!counts.hasOwnProperty(character.category)) throw new Error(`category ${character.category}`);
  counts[character.category]++;
  const colors = character.textures.filter((file) => /color/i.test(file) && !/normal|specular|wrinkle/i.test(file));
  if (colors.length === 0) throw new Error(`no color texture ${character.id}`);
}
if (counts.Adults !== 40 || counts.Children !== 4 || counts.Professions !== 71) {
  throw new Error(`category counts ${JSON.stringify(counts)}`);
}
if (animations.length < 200) throw new Error(`expected animation groups, got ${animations.length}`);
const withStatic = animations.filter((anim) => anim.motions.static?.female || anim.motions.static?.male);
if (withStatic.length < 150) throw new Error(`static motion files missing (${withStatic.length})`);

const tga = Buffer.alloc(18 + 2 * 2 * 3);
tga[2] = 2;
tga.writeUInt16LE(2, 12);
tga.writeUInt16LE(2, 14);
tga[16] = 24;
const bgr = [
  0, 0, 255, 0, 255, 0,
  255, 0, 0, 255, 255, 255,
];
Buffer.from(bgr).copy(tga, 18);
const image = decodeTga(tga);
const px = (x, y) => [image.pixels[(y * 2 + x) * 4], image.pixels[(y * 2 + x) * 4 + 1], image.pixels[(y * 2 + x) * 4 + 2]];
const expect = (got, want, label) => {
  if (got.join(',') !== want.join(',')) throw new Error(`${label}: ${got} != ${want}`);
};
expect(px(0, 0), [0, 0, 255], 'top-left blue');
expect(px(1, 0), [255, 255, 255], 'top-right white');
expect(px(0, 1), [255, 0, 0], 'bottom-left red');
expect(px(1, 1), [0, 255, 0], 'bottom-right green');

const png = await tgaToPng(tga, 1024);
if (png[0] !== 0x89 || png.toString('ascii', 1, 4) !== 'PNG') throw new Error('PNG signature missing');
console.log(`catalog ok: ${characters.length} characters, ${animations.length} animations`);
