import {
  Box3,
  BufferGeometry,
  DoubleSide,
  Group,
  LoadingManager,
  Mesh,
  MeshStandardMaterial,
  type AnimationClip,
  type Object3D,
} from 'three';
import type { Gender } from './types';

const MODEL_EXTENSIONS = new Set(['glb', 'gltf', 'vrm', 'obj', 'fbx', 'dae', 'stl', 'ply']);

export type ImportedModel = {
  group: Group;
  label: string;
  gender: Gender;
  bones: number;
  clips: number;
};

export async function importModelFiles(files: File[]): Promise<ImportedModel[]> {
  const models = files.filter((file) => MODEL_EXTENSIONS.has(extension(file.name)));
  if (models.length === 0) {
    throw new Error('Choose a GLB, VRM, GLTF, OBJ, FBX, DAE, STL, or PLY file.');
  }
  const byName = new Map<string, File>();
  for (const file of files) byName.set(basename(file.name), file);
  const urls: string[] = [];
  const manager = new LoadingManager();
  manager.setURLModifier((url) => resolveUrl(url, byName, urls));
  try {
    const imported: ImportedModel[] = [];
    for (const file of models) {
      const group = await loadFile(file, byName, manager);
      prepare(group);
      if (!group.name || group.name === 'Scene') group.name = labelFrom(file.name);
      imported.push({
        group,
        label: labelFrom(file.name),
        gender: guessGender(file.name),
        bones: countBones(group),
        clips: countClips(group),
      });
    }
    return imported;
  } finally {
    for (const url of urls) URL.revokeObjectURL(url);
  }
}

function resolveUrl(url: string, byName: Map<string, File>, urls: string[]): string {
  const name = basename(url);
  const file = byName.get(name);
  if (file) {
    const blob = URL.createObjectURL(file);
    urls.push(blob);
    return blob;
  }
  if (/\.(png|jpe?g|webp|tga|bmp|gif|tiff?)$/i.test(name) || url.includes('\\')) return '/neutral.png';
  return url;
}

async function loadFile(file: File, byName: Map<string, File>, manager: LoadingManager): Promise<Group> {
  const ext = extension(file.name);
  try {
    if (ext === 'glb' || ext === 'gltf' || ext === 'vrm') return await loadGltf(file, manager);
    if (ext === 'obj') return await loadObj(file, byName, manager);
    if (ext === 'fbx') return await loadFbx(file, manager);
    if (ext === 'dae') return await loadDae(file, manager);
    if (ext === 'stl') return await loadStl(file);
    if (ext === 'ply') return await loadPly(file);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Could not read that file.';
    throw new Error(`Could not import ${file.name}. ${detail}`);
  }
  throw new Error(`Could not import ${file.name}.`);
}

async function loadGltf(file: File, manager: LoadingManager): Promise<Group> {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ]);
  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  const data = await file.arrayBuffer();
  const gltf = await loader.parseAsync(data, '');
  return adopt(gltf.scene, gltf.animations);
}

async function loadObj(file: File, byName: Map<string, File>, manager: LoadingManager): Promise<Group> {
  const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
  const { MTLLoader } = await import('three/addons/loaders/MTLLoader.js');
  const text = await file.text();
  const loader = new OBJLoader(manager);
  const declared = text.match(/^mtllib\s+(.+)$/im)?.[1]?.trim() ?? '';
  const mtl = byName.get(basename(declared)) ?? byName.get(basename(file.name.replace(/\.obj$/i, '.mtl')));
  if (mtl) {
    const creator = new MTLLoader(manager).parse(await mtl.text(), '');
    creator.preload();
    loader.setMaterials(creator);
  }
  return adopt(loader.parse(text), []);
}

async function loadFbx(file: File, manager: LoadingManager): Promise<Group> {
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
  const loader = new FBXLoader(manager);
  const group = loader.parse(await file.arrayBuffer(), '') as Group;
  return adopt(group, group.animations);
}

async function loadDae(file: File, manager: LoadingManager): Promise<Group> {
  const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js');
  const parsed = new ColladaLoader(manager).parse(await file.text(), '') as { scene: Object3D; animations?: AnimationClip[] } | null;
  if (!parsed) throw new Error('The Collada file was empty.');
  return adopt(parsed.scene, parsed.animations ?? []);
}

async function loadStl(file: File): Promise<Group> {
  const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
  const geometry = new STLLoader().parse(await file.arrayBuffer());
  return meshGroup(file.name, geometry);
}

async function loadPly(file: File): Promise<Group> {
  const { PLYLoader } = await import('three/addons/loaders/PLYLoader.js');
  const geometry = new PLYLoader().parse(await file.arrayBuffer());
  return meshGroup(file.name, geometry);
}

function meshGroup(filename: string, geometry: BufferGeometry): Group {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const hasColor = geometry.hasAttribute('color');
  const material = new MeshStandardMaterial({
    color: hasColor ? 0xffffff : 0xd7c4b0,
    vertexColors: hasColor,
    metalness: 0.04,
    roughness: 0.72,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = labelFrom(filename);
  const group = new Group();
  group.add(mesh);
  return group;
}

function adopt(object: Object3D, animations: AnimationClip[]): Group {
  let group: Group;
  if ((object as Group).isGroup) {
    if (animations.length > 0) object.animations = animations;
    group = object as Group;
  } else {
    group = new Group();
    group.name = object.name;
    group.animations = animations;
    for (const child of [...object.children]) group.add(child);
  }
  return liftExportedPivot(group);
}

// A file from this app stores the stage position on the character, under an empty
// RocketboxStage node. Use the character as the root so the gizmo returns to her feet.
function liftExportedPivot(root: Group): Group {
  const wrapper = root.children.find((child) => child.name === 'RocketboxStage');
  if (!wrapper || wrapper.children.length !== 1) return root;
  const character = wrapper.children[0];
  const group = new Group();
  group.name = character.name;
  group.position.copy(character.position);
  group.quaternion.copy(character.quaternion);
  group.scale.copy(character.scale);
  const clips = root.animations.length > 0 ? root.animations : character.animations;
  if (clips.length > 0) group.animations = clips;
  const keepsSelf = (character as Mesh).isMesh === true || (character as { isBone?: boolean }).isBone === true;
  if (keepsSelf) {
    character.position.set(0, 0, 0);
    character.quaternion.identity();
    character.scale.set(1, 1, 1);
    group.add(character);
  } else {
    for (const child of [...character.children]) group.add(child);
  }
  return group;
}

function prepare(root: Group) {
  const lights: Object3D[] = [];
  root.traverse((object) => {
    const mesh = object as Mesh;
    if ((object as { isLight?: boolean }).isLight) lights.push(object);
    if (mesh.isMesh) mesh.frustumCulled = false;
  });
  for (const light of lights) light.removeFromParent();
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  const height = box.max.y - box.min.y;
  if (height > 8 || (height > 0 && height < 0.3)) root.scale.multiplyScalar(1.7 / height);
}

function countBones(root: Object3D): number {
  let bones = 0;
  root.traverse((object) => {
    if ((object as { isBone?: boolean }).isBone) bones += 1;
  });
  return bones;
}

function countClips(root: Object3D): number {
  const clips = new Set<AnimationClip>();
  const take = (list?: AnimationClip[]) => {
    for (const clip of list ?? []) clips.add(clip);
  };
  take(root.animations);
  root.traverse((object) => take(object.animations));
  return clips.size;
}

function guessGender(name: string): Gender {
  const lower = name.toLowerCase();
  if (/\bfemale\b|\bwoman\b|\bgirl\b/.test(lower)) return 'female';
  if (/\bmale\b|\bman\b|\bboy\b|\bguy\b/.test(lower)) return 'male';
  return 'female';
}

function labelFrom(filename: string): string {
  const base = filename.replace(/^.*[/\\]/, '');
  const stem = base.replace(/\.[^.]+$/, '').trim();
  return stem || 'Import';
}

function extension(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename);
  return match ? match[1].toLowerCase() : '';
}

function basename(url: string): string {
  const clean = url.split('?')[0].split('#')[0];
  const parts = clean.split(/[/\\]/);
  try {
    return decodeURIComponent(parts[parts.length - 1] ?? '').toLowerCase();
  } catch {
    return (parts[parts.length - 1] ?? '').toLowerCase();
  }
}
