import { AnimationClip, Group, PropertyBinding, Vector3, type Object3D } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

export async function exportGlb(actors: Object3D[], clipsByActor: AnimationClip[][], filename: string): Promise<void> {
  const root = new Group();
  root.name = 'RocketboxStage';
  const animations: AnimationClip[] = [];
  // The gizmo sits on the character pivot (her feet). The stage position is only
  // where she was standing, so leave that behind and keep the pivot at the origin.
  const origin = actors[0]?.position.clone() ?? new Vector3();

  actors.forEach((actor, index) => {
    const copy = cloneSkeleton(actor);
    copy.position.sub(origin);
    const prefix = `a${index + 1}_`;
    prefixNames(copy, prefix);
    root.add(copy);
    for (const clip of clipsByActor[index] ?? []) {
      if (clip.tracks.length === 0) continue;
      animations.push(prefixClip(clip, prefix));
    }
  });

  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(root, {
    binary: true,
    animations,
    onlyVisible: true,
    copyright: 'Microsoft Rocketbox Avatar Library, MIT License. Animation data from the Rocketbox animation release.',
  });
  if (!(result instanceof ArrayBuffer)) throw new Error('Exporter did not return a GLB');
  download(result, filename);
}

function prefixNames(root: Object3D, prefix: string) {
  root.traverse((object) => {
    if (object.name) object.name = prefix + object.name;
  });
}

function prefixClip(clip: AnimationClip, prefix: string): AnimationClip {
  const tracks = clip.tracks.map((track) => {
    const copy = track.clone();
    const parsed = PropertyBinding.parseTrackName(copy.name);
    const nodeName = parsed.nodeName ?? '';
    const dot = copy.name.lastIndexOf('.');
    if (nodeName && dot > 0) copy.name = prefix + nodeName + copy.name.slice(dot);
    return copy;
  });
  return new AnimationClip(clip.name, clip.duration, tracks);
}

function download(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
