import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import type { AnimationClip, Group, LoadingManager } from 'three';

export type LoadedFbx = Group & { animations: AnimationClip[] };

const loader = new FBXLoader();
redirectTextureRequests(loader.manager);

let chain: Promise<void> = Promise.resolve();

export function parseFbx(buffer: ArrayBuffer): Promise<LoadedFbx> {
  const run = chain.then(() => loader.parse(buffer, '') as LoadedFbx);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${url} (${response.status})`);
  return response.arrayBuffer();
}

function redirectTextureRequests(manager: LoadingManager) {
  manager.setURLModifier((url) => {
    if (url.startsWith('/rocketbox') || url.startsWith('/neutral') || url.startsWith('data:') || url.startsWith('blob:')) {
      return url;
    }
    const lower = url.toLowerCase();
    if (lower.includes('.tga') || lower.includes('\\') || /^[a-z]:/.test(lower)) return '/neutral.png';
    return url;
  });
}
