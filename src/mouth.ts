import { Bone, Quaternion, Vector3 } from 'three';

// Rocketbox heads have no morph targets. Body clips key the lips and jaw shut,
// which fights the viseme. While a line is playing those bones are put back on
// their rest pose so they stay loose, and the viseme drops the jaw from there
// (head-local +X is up, plus a small hinge). Brows and eyes stay on the clip.

export type MouthShape = {
  jaw: number;
  round: number;
  stretch: number;
  close: number;
};

export const MOUTH_REST: MouthShape = { jaw: 0, round: 0, stretch: 0, close: 0 };

type FaceRole = 'jaw' | 'upper' | 'lower' | 'cornerL' | 'cornerR' | 'upperL' | 'upperR' | 'lowerL' | 'lowerR';

const ROLES: [string, FaceRole][] = [
  ['Bip01_MJaw', 'jaw'],
  ['Bip01_MUpperLip', 'upper'],
  ['Bip01_MBottomLip', 'lower'],
  ['Bip01_LMouthCorner', 'cornerL'],
  ['Bip01_RMouthCorner', 'cornerR'],
  ['Bip01_LUpperlip', 'upperL'],
  ['Bip01_RUpperlip', 'upperR'],
  ['Bip01_LMouthBottom', 'lowerL'],
  ['Bip01_RMouthBottom', 'lowerR'],
];

export type FaceBone = {
  role: FaceRole;
  bone: Bone;
  restPosition: Vector3;
  restQuaternion: Quaternion;
};

type RestBone = {
  bone: Bone;
  position: Vector3;
  quaternion: Quaternion;
};

const turn = new Quaternion();
const axisZ = new Vector3(0, 0, 1);

export function bindFace(bones: RestBone[]): FaceBone[] {
  const byName = new Map(bones.map((entry) => [entry.bone.name, entry]));
  const rig: FaceBone[] = [];
  for (const [name, role] of ROLES) {
    const found = byName.get(name);
    if (!found) continue;
    rig.push({
      role,
      bone: found.bone,
      restPosition: found.position,
      restQuaternion: found.quaternion,
    });
  }
  return rig;
}

export function hasJaw(rig: FaceBone[]): boolean {
  return rig.some((entry) => entry.role === 'jaw');
}

// Centimeters. A full "ah" (open = 1) lowers the chin bone by this much.
const JAW_DROP = 3;

export function applyFace(rig: FaceBone[], shape: MouthShape) {
  const open = clamp(shape.jaw) * (1 - clamp(shape.close));
  for (const entry of rig) {
    entry.bone.quaternion.copy(entry.restQuaternion);
    entry.bone.position.copy(entry.restPosition);
    if (entry.role === 'jaw' && open > 0) {
      entry.bone.position.x -= JAW_DROP * open;
      turn.setFromAxisAngle(axisZ, open * 0.22);
      entry.bone.quaternion.multiply(turn);
    }
    entry.bone.updateMatrix();
  }
}

export function releaseFace(rig: FaceBone[]) {
  for (const entry of rig) {
    entry.bone.position.copy(entry.restPosition);
    entry.bone.quaternion.copy(entry.restQuaternion);
    entry.bone.updateMatrix();
  }
}

function clamp(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
