import {
  ACESFilmicToneMapping,
  AnimationMixer,
  Bone,
  Box3,
  Matrix4,
  CircleGeometry,
  Clock,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  Quaternion,
  Raycaster,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { applyFace, bindFace, releaseFace, type FaceBone, type MouthShape } from './mouth';
import type { Gender } from './types';

export type StageActor = {
  uid: string;
  characterId: string;
  label: string;
  gender: Gender;
  category: string;
  object: Object3D;
  mixer: AnimationMixer;
  checked: Set<string>;
  playingId: string | null;
  height: number;
  rest: BoneRest[];
  face: FaceBone[];
  mouth: MouthShape | null;
  faceOpen: boolean;
};

type BoneRest = {
  bone: Bone;
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
};

type ActorMeta = {
  characterId: string;
  label: string;
  gender: Gender;
  category: string;
};

function captureRest(object: Object3D): BoneRest[] {
  const rest: BoneRest[] = [];
  object.traverse((node) => {
    const bone = node as Bone;
    if (!bone.isBone) return;
    rest.push({
      bone,
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone(),
      scale: bone.scale.clone(),
    });
  });
  return rest;
}

export class Stage {
  readonly actors: StageActor[] = [];
  selected: StageActor | null = null;
  onChange: () => void = () => {};
  onFrame: () => void = () => {};

  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly renderer: WebGLRenderer;
  private readonly orbit: OrbitControls;
  private readonly transform: TransformControls;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly floorPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly ring: Mesh;
  private readonly clock = new Clock();
  private uid = 0;
  private pointerDown = { x: 0, y: 0 };
  private mode: 'translate' | 'rotate' | 'scale' = 'translate';

  constructor(container: HTMLElement) {
    this.scene.background = new Color(0x2c2825);
    this.scene.fog = null;

    this.camera = new PerspectiveCamera(38, 1, 0.05, 80);
    this.camera.position.set(2.6, 1.55, 3.6);

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    const hemi = new HemisphereLight(0xfff6ea, 0x6f675e, 1.15);
    const key = new DirectionalLight(0xffffff, 2.1);
    key.position.set(4, 7, 3);
    const fill = new DirectionalLight(0xd5def0, 0.65);
    fill.position.set(-4, 3, -2);
    this.scene.add(hemi, key, fill);

    const floor = new Mesh(
      new CircleGeometry(9, 72),
      new MeshStandardMaterial({ color: 0x3a342f, roughness: 1, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = false;
    this.scene.add(floor);

    const grid = new GridHelper(12, 24, 0x8d8478, 0x463f3a);
    grid.position.y = 0.002;
    this.scene.add(grid);

    this.ring = new Mesh(
      new RingGeometry(0.32, 0.4, 48),
      new MeshBasicMaterial({ color: 0xc46a2f, side: 2 }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.ring.visible = false;
    this.ring.raycast = () => {};
    this.scene.add(this.ring);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0.9, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.minDistance = 0.7;
    this.orbit.maxDistance = 16;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.orbit.update();

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.size = 0.75;
    this.transform.space = 'world';
    this.scene.add(this.transform.getHelper());
    this.transform.addEventListener('dragging-changed', (event) => {
      this.orbit.enabled = !event.value;
    });

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (event) => {
      this.pointerDown = { x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener('pointerup', (event) => {
      const dx = event.clientX - this.pointerDown.x;
      const dy = event.clientY - this.pointerDown.y;
      if (dx * dx + dy * dy > 16) return;
      if (this.transform.dragging || this.transform.axis) return;
      this.selectFromPointer(event.clientX, event.clientY);
    });

    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const frame = () => {
      const delta = this.clock.getDelta();
      for (const actor of this.actors) actor.mixer.update(delta);
      this.onFrame();
      for (const actor of this.actors) this.poseFace(actor);
      if (this.selected) {
        this.ring.visible = true;
        this.ring.position.x = this.selected.object.position.x;
        this.ring.position.z = this.selected.object.position.z;
      } else {
        this.ring.visible = false;
      }
      this.orbit.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(frame);
    };
    frame();
  }

  groundPoint(clientX: number, clientY: number): Vector3 {
    this.setPointer(clientX, clientY);
    const hit = new Vector3();
    if (this.raycaster.ray.intersectPlane(this.floorPlane, hit)) return hit;
    return new Vector3();
  }

  nextPoint(): Vector3 {
    const index = this.actors.length;
    return new Vector3(((index % 5) - 2) * 0.9, 0, Math.floor(index / 5) * 0.9);
  }

  add(object: Object3D, meta: ActorMeta, point: Vector3): StageActor {
    this.plant(object, point);
    object.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(object);
    const actor: StageActor = {
      uid: `a${++this.uid}`,
      characterId: meta.characterId,
      label: meta.label,
      gender: meta.gender,
      category: meta.category,
      object,
      mixer: new AnimationMixer(object),
      checked: new Set(),
      playingId: null,
      height: bounds.max.y - bounds.min.y,
      rest: captureRest(object),
      face: [],
      mouth: null,
      faceOpen: false,
    };
    actor.face = bindFace(actor.rest);
    object.userData.actorUid = actor.uid;
    this.scene.add(object);
    this.actors.push(actor);
    this.select(actor);
    return actor;
  }

  setMode(mode: 'translate' | 'rotate' | 'scale') {
    this.mode = mode;
    this.transform.mode = mode;
    this.transform.space = mode === 'translate' ? 'world' : 'local';
    this.onChange();
  }

  getMode(): 'translate' | 'rotate' | 'scale' {
    return this.mode;
  }

  deselect() {
    this.select(null);
  }

  // Recenters the camera only when the selected character is outside the view, so a preview
  // is visible without pulling the camera off a shot the user already framed.
  ensureVisible() {
    const actor = this.selected;
    if (!actor) return;
    const focus = new Vector3();
    actor.object.getWorldPosition(focus);
    focus.y += Math.min(Math.max(actor.height * 0.5, 0.6), 1.3);
    const ndc = focus.clone().project(this.camera);
    if (ndc.z < 1 && Math.abs(ndc.x) < 0.72 && Math.abs(ndc.y) < 0.72) return;
    const offset = this.camera.position.clone().sub(this.orbit.target);
    if (offset.length() < 0.8 || offset.length() > 12) offset.set(1.6, 0.55, 2.6);
    this.orbit.target.copy(focus);
    this.camera.position.copy(focus).add(offset);
    this.orbit.update();
  }

  // Pulls the camera in so the selected body or face fills the view, keeping the current angle.
  fitSelected(part: 'body' | 'face' = 'body'): boolean {
    const actor = this.selected;
    if (!actor) return false;
    actor.object.updateMatrixWorld(true);
    const box = part === 'face' ? this.faceBox(actor) : new Box3().setFromObject(actor.object);
    if (!box || box.isEmpty()) return false;
    const center = box.getCenter(new Vector3());
    const direction = this.camera.position.clone().sub(this.orbit.target);
    if (direction.lengthSq() < 1e-8) direction.set(0.35, 0.15, 1);
    direction.normalize();
    const worldUp = new Vector3(0, 1, 0);
    const right = new Vector3().crossVectors(worldUp, direction);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const camUp = new Vector3().crossVectors(direction, right).normalize();
    const vFov = (this.camera.fov * Math.PI) / 180;
    const tanV = Math.tan(vFov / 2);
    const tanH = Math.tan(Math.atan(tanV * this.camera.aspect));
    const xs = [box.min.x, box.max.x];
    const ys = [box.min.y, box.max.y];
    const zs = [box.min.z, box.max.z];
    const offset = new Vector3();
    let distance = 0.5;
    for (const x of xs) {
      for (const y of ys) {
        for (const z of zs) {
          offset.set(x, y, z).sub(center);
          const along = offset.dot(direction);
          const needV = along + Math.abs(offset.dot(camUp)) / tanV;
          const needH = along + Math.abs(offset.dot(right)) / tanH;
          distance = Math.max(distance, needV, needH);
        }
      }
    }
    distance *= 1.08;
    this.orbit.target.copy(center);
    this.camera.position.copy(center).add(direction.multiplyScalar(distance));
    this.camera.near = Math.max(0.01, distance / 80);
    this.camera.far = Math.max(80, distance * 40);
    this.camera.updateProjectionMatrix();
    this.orbit.update();
    return true;
  }

  // Rocketbox heads are Bip01_Head, in centimeters, with +X up. Other imports use
  // their own head bone or a head mesh, framed in world space.
  private faceBox(actor: StageActor): Box3 | null {
    const head = this.findHeadBone(actor);
    if (head && head.name.replace(/^a\d+_/, '') === 'Bip01_Head') return this.rocketboxFaceBox(actor, head);
    const framed = new Box3();
    this.expandByHeadMeshes(actor, framed);
    if (!framed.isEmpty()) return this.padBox(framed, 0.08);
    this.expandByFacePoints(actor, framed);
    if (!framed.isEmpty()) {
      const size = framed.getSize(new Vector3());
      const span = Math.max(size.x, size.y, size.z);
      return this.padBox(framed, 0, Math.max(0.045, span * 0.7));
    }
    if (!head) return null;
    const reach = Math.min(Math.max(actor.height * 0.16, 0.18), 0.34);
    const center = head.getWorldPosition(new Vector3());
    return new Box3().setFromCenterAndSize(center, new Vector3(reach, reach, reach));
  }

  private findHeadBone(actor: StageActor): Bone | null {
    let rocketbox: Bone | null = null;
    let named: Bone | null = null;
    actor.object.traverse((node) => {
      const bone = node as Bone;
      if (!bone.isBone) return;
      const name = bone.name.replace(/^a\d+_/, '');
      if (name === 'Bip01_Head') rocketbox = bone;
      else if (!named && this.isHeadName(name)) named = bone;
    });
    return rocketbox ?? named;
  }

  private isHeadName(name: string): boolean {
    if (/eye|jaw|lip|mouth|brow|nose|teeth|tongue|ear|lid/i.test(name)) return false;
    return /head$/i.test(name);
  }

  private expandByHeadMeshes(actor: StageActor, framed: Box3) {
    const meshBox = new Box3();
    actor.object.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      if (!/head|face|hair|skull/i.test(mesh.name)) return;
      if (/eye|teeth|tooth|tongue/i.test(mesh.name)) return;
      meshBox.setFromObject(mesh);
      if (meshBox.isEmpty()) return;
      const height = meshBox.max.y - meshBox.min.y;
      if (actor.height > 0 && height > actor.height * 0.5) return;
      framed.union(meshBox);
    });
  }

  private expandByFacePoints(actor: StageActor, framed: Box3) {
    actor.object.traverse((node) => {
      const bone = node as Bone;
      if (!bone.isBone) return;
      if (!/Head|Eye|Jaw|Lip|Mouth|Eyebrow|Nose/i.test(bone.name)) return;
      framed.expandByPoint(bone.getWorldPosition(new Vector3()));
    });
  }

  private padBox(box: Box3, fraction: number, extra = 0): Box3 {
    const size = box.getSize(new Vector3());
    const pad = Math.max(size.x, size.y, size.z) * fraction + extra;
    box.expandByScalar(pad);
    return box;
  }

  // Head-local centimeters. +X is up, +Y is forward, +Z is the character's left.
  // The measured face bones sit inside the skull, so the box is padded out to the
  // chin, hair, nose, and ears.
  private rocketboxFaceBox(actor: StageActor, head: Bone): Box3 {
    const points: Vector3[] = [];
    actor.object.traverse((node) => {
      const bone = node as Bone;
      if (!bone.isBone) return;
      if (/Head|Eye|Jaw|Lip|Mouth|Eyebrow|Nose/i.test(bone.name)) {
        points.push(bone.getWorldPosition(new Vector3()));
      }
    });
    const toLocal = new Matrix4().copy(head.matrixWorld).invert();
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    const local = new Vector3();
    for (const point of points) {
      local.copy(point).applyMatrix4(toLocal);
      minX = Math.min(minX, local.x);
      minY = Math.min(minY, local.y);
      minZ = Math.min(minZ, local.z);
      maxX = Math.max(maxX, local.x);
      maxY = Math.max(maxY, local.y);
      maxZ = Math.max(maxZ, local.z);
    }
    if (!Number.isFinite(minX)) {
      minX = -4;
      maxX = 18;
      minY = -6;
      maxY = 14;
      minZ = -8;
      maxZ = 8;
    } else {
      minX -= 5;
      maxX += 7;
      minY -= 2;
      maxY += 3;
      minZ -= 4.5;
      maxZ += 4.5;
    }
    const box = new Box3();
    const corner = new Vector3();
    for (const x of [minX, maxX]) {
      for (const y of [minY, maxY]) {
        for (const z of [minZ, maxZ]) {
          corner.set(x, y, z).applyMatrix4(head.matrixWorld);
          box.expandByPoint(corner);
        }
      }
    }
    return box;
  }

  // The loaded standing pose. skeleton.pose() decomposes the FBX bind matrix and
  // writes a centimeter-scale onto the bones, which blows the character up.
  private poseFace(actor: StageActor) {
    if (actor.face.length === 0) return;
    if (actor.mouth) {
      applyFace(actor.face, actor.mouth);
      actor.object.updateMatrixWorld(true);
      actor.faceOpen = true;
      return;
    }
    if (!actor.faceOpen) return;
    releaseFace(actor.face);
    actor.object.updateMatrixWorld(true);
    actor.faceOpen = false;
  }

  restoreRest(actor: StageActor) {
    for (const pose of actor.rest) {
      pose.bone.position.copy(pose.position);
      pose.bone.quaternion.copy(pose.quaternion);
      pose.bone.scale.copy(pose.scale);
    }
    actor.object.updateMatrixWorld(true);
  }

  deleteSelected() {
    if (!this.selected) return;
    this.transform.detach();
    this.selected.mixer.stopAllAction();
    this.selected.object.removeFromParent();
    const index = this.actors.indexOf(this.selected);
    if (index >= 0) this.actors.splice(index, 1);
    this.selected = null;
    this.onChange();
  }

  private plant(object: Object3D, point: Vector3) {
    object.position.set(point.x, 0, point.z);
    object.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(object);
    object.position.y -= bounds.min.y;
  }

  private select(actor: StageActor | null) {
    this.selected = actor;
    if (actor) this.transform.attach(actor.object);
    else this.transform.detach();
    this.onChange();
  }

  private selectFromPointer(clientX: number, clientY: number) {
    this.setPointer(clientX, clientY);
    const meshes: Object3D[] = [];
    for (const actor of this.actors) {
      actor.object.traverse((object) => {
        if ((object as Mesh).isMesh && object.visible) meshes.push(object);
      });
    }
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) {
      this.select(null);
      return;
    }
    let current: Object3D | null = hits[0].object;
    while (current) {
      const actor = this.actors.find((item) => item.object === current);
      if (actor) {
        this.select(actor);
        return;
      }
      current = current.parent;
    }
    this.select(null);
  }

  private setPointer(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }
}
