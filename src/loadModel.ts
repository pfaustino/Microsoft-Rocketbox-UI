import {
  Box3,
  ClampToEdgeWrapping,
  DoubleSide,
  FrontSide,
  LoadingManager,
  Mesh,
  SRGBColorSpace,
  TextureLoader,
  type Group,
  type Material,
  type MeshPhongMaterial,
  type Object3D,
  type Texture,
} from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { fetchBuffer, parseFbx } from './fbx';
import { characterFbxPath, rocketboxUrl, textureUrl } from './paths';
import type { CharacterRecord } from './types';

const templates = new Map<string, Promise<Group>>();
const textureLoader = new TextureLoader(new LoadingManager());

export function loadTemplate(character: CharacterRecord): Promise<Group> {
  const existing = templates.get(character.id);
  if (existing) return existing;
  const pending = buildTemplate(character).catch((error: unknown) => {
    templates.delete(character.id);
    throw error;
  });
  templates.set(character.id, pending);
  return pending;
}

export function cloneTemplate(template: Group): Group {
  return cloneSkeleton(template) as Group;
}

async function buildTemplate(character: CharacterRecord): Promise<Group> {
  const url = rocketboxUrl(characterFbxPath(character.id, character.folder));
  const [buffer, textures] = await Promise.all([fetchBuffer(url), loadColorTextures(character)]);
  const model = await parseFbx(buffer);
  removeLights(model);
  dropLowerDetail(model);
  applyCentimeterScale(model);
  paint(model, textures);
  model.traverse((object) => {
    if ((object as Mesh).isMesh) (object as Mesh).frustumCulled = false;
  });
  model.animations = [];
  return model;
}

async function loadColorTextures(character: CharacterRecord): Promise<Map<string, Texture>> {
  const files = character.textures.filter(isColorMap);
  const entries = await Promise.all(
    files.map(async (file) => {
      const texture = await textureLoader.loadAsync(textureUrl(character.id, file));
      texture.colorSpace = SRGBColorSpace;
      texture.wrapS = ClampToEdgeWrapping;
      texture.wrapT = ClampToEdgeWrapping;
      texture.anisotropy = 8;
      texture.name = file;
      return [file.toLowerCase(), texture] as const;
    }),
  );
  return new Map(entries);
}

function paint(root: Object3D, textures: Map<string, Texture>) {
  const files = [...textures.keys()];
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) finishMaterial(material, files, textures);
  });
}

function finishMaterial(material: Material, files: string[], textures: Map<string, Texture>) {
  const phong = material as MeshPhongMaterial;
  clearExtraMaps(phong);
  const file = matchTexture(material.name, files);
  const texture = file ? textures.get(file) ?? null : null;
  phong.map = texture;
  phong.color.set(texture ? 0xffffff : 0xd7c4b0);
  if ('specular' in phong && phong.specular?.isColor) phong.specular.set(0x222222);
  if ('shininess' in phong) phong.shininess = 12;
  if (/opacity/i.test(material.name)) {
    phong.alphaTest = 0.35;
    phong.transparent = false;
    phong.side = DoubleSide;
    phong.depthWrite = true;
  } else {
    phong.side = FrontSide;
  }
  phong.needsUpdate = true;
}

function clearExtraMaps(material: MeshPhongMaterial) {
  material.normalMap = null;
  material.bumpMap = null;
  material.specularMap = null;
  material.alphaMap = null;
  material.lightMap = null;
  material.aoMap = null;
  material.displacementMap = null;
  material.emissiveMap = null;
}

function matchTexture(materialName: string, files: string[]): string | null {
  const name = materialName.toLowerCase().trim();
  if (!name) return null;
  const exact = `${name}_color.tga`;
  if (files.includes(exact)) return exact;
  const prefixed = files.filter((file) => file.startsWith(`${name}_`) && file.includes('color'));
  prefixed.sort((a, b) => a.length - b.length);
  return prefixed[0] ?? null;
}

function isColorMap(file: string): boolean {
  const name = file.toLowerCase();
  return name.endsWith('.tga') && name.includes('color') && !/normal|specular|wrinkle/.test(name);
}

function removeLights(root: Object3D) {
  const lights: Object3D[] = [];
  root.traverse((object) => {
    if ((object as { isLight?: boolean }).isLight) lights.push(object);
  });
  for (const light of lights) light.removeFromParent();
}

function dropLowerDetail(root: Object3D) {
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if ((object as Mesh).isMesh) meshes.push(object as Mesh);
  });
  for (const mesh of meshes) {
    if (!/lowpoly|midpoly/i.test(mesh.name) || /hipoly/i.test(mesh.name)) continue;
    const parent = mesh.parent;
    if (!parent) continue;
    for (const child of [...mesh.children]) parent.attach(child);
    mesh.removeFromParent();
  }
}

function applyCentimeterScale(root: Group) {
  const unit = root.userData.unitScaleFactor;
  const toMeters = (typeof unit === 'number' ? unit : 1) * 0.01;
  if (Math.abs(toMeters - 1) > 0.0001) root.scale.multiplyScalar(toMeters);
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  const height = box.max.y - box.min.y;
  if (height > 8 || (height > 0 && height < 0.3)) root.scale.multiplyScalar(1.7 / height);
}
