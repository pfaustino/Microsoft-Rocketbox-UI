import { AnimationClip, LoopOnce, LoopRepeat, PropertyBinding, Quaternion, Vector3, type Object3D } from 'three';
import { fetchBuffer, parseFbx, type LoadedFbx } from './fbx';
import { rocketboxUrl } from './paths';

export type RetargetedClip = {
  clip: AnimationClip;
  matched: number;
  total: number;
};

type RestSample = {
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
};

type RawClip = {
  clip: AnimationClip;
  rest: Map<string, RestSample>;
};

const rawClips = new Map<string, Promise<RawClip>>();
const retargeted = new Map<string, Promise<RetargetedClip>>();

export function loadRetargetedClip(relativePath: string, root: Object3D, name: string): Promise<RetargetedClip> {
  const key = `${relativePath}|${skeletonKey(root)}|${name}`;
  const existing = retargeted.get(key);
  if (existing) return existing;
  const pending = loadRawClip(relativePath)
    .then((raw) => adaptClip(raw.clip, raw.rest, root, name))
    .catch((error: unknown) => {
      retargeted.delete(key);
      throw error;
    });
  retargeted.set(key, pending);
  return pending;
}

function loadRawClip(relativePath: string): Promise<RawClip> {
  const existing = rawClips.get(relativePath);
  if (existing) return existing;
  const pending = fetchBuffer(rocketboxUrl(relativePath))
    .then((buffer) => parseFbx(buffer))
    .then((model) => takeClip(model, relativePath))
    .catch((error: unknown) => {
      rawClips.delete(relativePath);
      throw error;
    });
  rawClips.set(relativePath, pending);
  return pending;
}

function takeClip(model: LoadedFbx, relativePath: string): RawClip {
  const rest = captureRest(model);
  const clips = model.animations.map((clip) => clip.clone());
  disposeModel(model);
  if (clips.length === 0) throw new Error(`No animation in ${relativePath}`);
  clips.sort((a, b) => b.tracks.length - a.tracks.length);
  return { clip: clips[0], rest };
}

export function adaptClip(source: AnimationClip, sourceRest: Map<string, RestSample>, root: Object3D, name: string): RetargetedClip {
  const targetRest = captureRest(root);
  const unit = lengthScale(sourceRest, targetRest);
  const tracks = [];
  for (const track of source.tracks) {
    let nodeName = '';
    let propertyName = '';
    try {
      const parsed = PropertyBinding.parseTrackName(track.name);
      nodeName = parsed.nodeName ?? '';
      propertyName = parsed.propertyName ?? '';
    } catch {
      continue;
    }
    const target = targetRest.get(nodeName);
    if (!nodeName || !target) continue;
    const copy = track.clone();
    const from = sourceRest.get(nodeName);
    if (from && propertyName === 'quaternion') rewriteQuaternion(copy.values, from.quaternion, target.quaternion);
    else if (from && propertyName === 'position') rewritePosition(copy.values, from.position, target.position, unit);
    else if (from && propertyName === 'scale') rewriteScale(copy.values, from.scale, target.scale);
    else if (!poseAgrees(copy.values, propertyName, target)) continue;
    tracks.push(copy);
  }
  return {
    clip: new AnimationClip(name, source.duration, tracks),
    matched: tracks.length,
    total: source.tracks.length,
  };
}

function captureRest(root: Object3D): Map<string, RestSample> {
  const rest = new Map<string, RestSample>();
  root.traverse((object) => {
    if (!object.name || rest.has(object.name)) return;
    rest.set(object.name, {
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
    });
  });
  return rest;
}

function lengthScale(source: Map<string, RestSample>, target: Map<string, RestSample>): number {
  const ratios: number[] = [];
  for (const [name, from] of source) {
    const to = target.get(name);
    if (!to) continue;
    const sourceLength = from.position.length();
    const targetLength = to.position.length();
    if (sourceLength < 1e-4 || targetLength < 1e-4) continue;
    ratios.push(targetLength / sourceLength);
  }
  if (ratios.length === 0) return 1;
  ratios.sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length / 2)];
}

const keyQuaternion = new Quaternion();
const deltaQuaternion = new Quaternion();
const outQuaternion = new Quaternion();
const keyPosition = new Vector3();
const outPosition = new Vector3();

function rewriteQuaternion(values: ArrayLike<number>, source: Quaternion, target: Quaternion) {
  const written = values as number[];
  for (let index = 0; index + 3 < values.length; index += 4) {
    keyQuaternion.set(values[index], values[index + 1], values[index + 2], values[index + 3]);
    deltaQuaternion.copy(source).invert().multiply(keyQuaternion);
    outQuaternion.copy(target).multiply(deltaQuaternion);
    written[index] = outQuaternion.x;
    written[index + 1] = outQuaternion.y;
    written[index + 2] = outQuaternion.z;
    written[index + 3] = outQuaternion.w;
  }
}

function rewritePosition(values: ArrayLike<number>, source: Vector3, target: Vector3, unit: number) {
  const written = values as number[];
  for (let index = 0; index + 2 < values.length; index += 3) {
    keyPosition.set(values[index], values[index + 1], values[index + 2]);
    outPosition.copy(keyPosition).sub(source).multiplyScalar(unit).add(target);
    written[index] = outPosition.x;
    written[index + 1] = outPosition.y;
    written[index + 2] = outPosition.z;
  }
}

function rewriteScale(values: ArrayLike<number>, source: Vector3, target: Vector3) {
  const written = values as number[];
  const from = [source.x, source.y, source.z];
  const to = [target.x, target.y, target.z];
  for (let index = 0; index + 2 < values.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const basis = from[axis];
      written[index + axis] = Math.abs(basis) < 1e-8 ? to[axis] : to[axis] * (values[index + axis] / basis);
    }
  }
}

function poseAgrees(values: ArrayLike<number>, propertyName: string, target: RestSample): boolean {
  if (propertyName === 'quaternion' && values.length >= 4) {
    keyQuaternion.set(values[0], values[1], values[2], values[3]);
    return Math.abs(target.quaternion.dot(keyQuaternion)) > 0.999;
  }
  if (propertyName === 'position' && values.length >= 3) {
    keyPosition.set(values[0], values[1], values[2]);
    return keyPosition.distanceTo(target.position) < 0.02;
  }
  if (propertyName === 'scale' && values.length >= 3) {
    return Math.abs(values[0] - target.scale.x) < 0.02
      && Math.abs(values[1] - target.scale.y) < 0.02
      && Math.abs(values[2] - target.scale.z) < 0.02;
  }
  return true;
}

function skeletonKey(root: Object3D): string {
  const names: string[] = [];
  root.traverse((object) => {
    if (!(object as { isBone?: boolean }).isBone) return;
    const position = object.position;
    const rotation = object.quaternion;
    names.push([
      object.name,
      position.x.toFixed(3), position.y.toFixed(3), position.z.toFixed(3),
      rotation.x.toFixed(3), rotation.y.toFixed(3), rotation.z.toFixed(3), rotation.w.toFixed(3),
    ].join(','));
  });
  return names.join('|');
}

function disposeModel(model: Object3D) {
  model.traverse((object) => {
    const mesh = object as { isMesh?: boolean; geometry?: { dispose: () => void } };
    if (mesh.isMesh) mesh.geometry?.dispose();
  });
}

export function loopStyle(animationId: string): { loop: typeof LoopOnce | typeof LoopRepeat; repetitions: number; clamp: boolean } {
  const once = /(^|_)(in|out)(_|$)/.test(animationId);
  return once
    ? { loop: LoopOnce, repetitions: 1, clamp: true }
    : { loop: LoopRepeat, repetitions: Infinity, clamp: false };
}
