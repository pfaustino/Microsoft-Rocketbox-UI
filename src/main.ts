import './style.css';
import { AnimationClip, LoopRepeat, type Mesh, type Object3D, type SkinnedMesh, type Texture } from 'three';
import { animationsById, catalog, charactersById } from './catalog';
import { exportGlb } from './exportGlb';
import { loadRetargetedClip, loopStyle } from './loadClip';
import { importModelFiles, type ImportedModel } from './importModel';
import { cloneTemplate, loadTemplate } from './loadModel';
import { motionLabel, resolveAnimation, rocketboxUrl, thumbnailPath } from './paths';
import type { Motion } from './types';
import { hasJaw } from './mouth';
import { primeSpeech, Speaker } from './speech';
import { chooseTalkGesture } from './talkGesture';
import { Stage, type StageActor } from './viewport';

const libraryCount = required<HTMLElement>('#library-count');
const librarySearch = required<HTMLInputElement>('#library-search');
const libraryList = required<HTMLElement>('#library-list');
const categoryChips = required<HTMLElement>('#category-chips');
const stageCount = required<HTMLElement>('#stage-count');
const stageElement = required<HTMLElement>('#stage');
const stageHint = required<HTMLElement>('#stage-hint');
const stageChip = required<HTMLElement>('#stage-chip');
const selectionMeta = required<HTMLElement>('#selection-meta');
const motionSelect = required<HTMLSelectElement>('#motion');
const groupSelect = required<HTMLSelectElement>('#anim-group');
const animSearch = required<HTMLInputElement>('#anim-search');
const animCount = required<HTMLElement>('#anim-count');
const animSelectAll = required<HTMLInputElement>('#anim-select-all');
const animList = required<HTMLElement>('#anim-list');
const status = required<HTMLElement>('#status');
const exportSelected = required<HTMLButtonElement>('#export-selected');
const exportStage = required<HTMLButtonElement>('#export-stage');
const importButton = required<HTMLButtonElement>('#import-model');
const importFile = required<HTMLInputElement>('#import-file');
const animFilters = required<HTMLElement>('#anim-filters');
const fileAnims = required<HTMLElement>('#file-anims');
const meshSearch = required<HTMLInputElement>('#mesh-search');
const meshCount = required<HTMLElement>('#mesh-count');
const meshList = required<HTMLElement>('#mesh-list');

const stage = new Stage(required<HTMLElement>('#viewport'));
const speaker = new Speaker<StageActor>();
speaker.onBlocked = setStatus;
primeSpeech();
const chatForm = required<HTMLFormElement>('#stage-chat');
const chatInput = required<HTMLTextAreaElement>('#chat-input');
const chatSend = required<HTMLButtonElement>('#chat-send');
let motion: Motion = 'static';
let fileActorId = '';
let meshActorId = '';
type CopiedFileClip = { clip: AnimationClip; checked: boolean; playing: boolean };
let animationClipboard: { ids: string[]; playingId: string | null; fileClips: CopiedFileClip[] | null } | null = null;
let wasSpeaking = false;
let category = 'All';
let loads = 0;

const categories = ['All', 'Adults', 'Children', 'Professions'];
for (const name of categories) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = name === 'All' ? 'All' : `${name}`;
  button.dataset.category = name;
  button.addEventListener('click', () => {
    category = name;
    for (const chip of categoryChips.querySelectorAll('button')) {
      chip.setAttribute('aria-pressed', chip.dataset.category === name ? 'true' : 'false');
    }
    filterLibrary();
  });
  categoryChips.appendChild(button);
}
categoryChips.querySelector('button')?.setAttribute('aria-pressed', 'true');

for (const character of catalog.characters) {
  const card = document.createElement('article');
  card.className = 'card';
  card.draggable = true;
  card.dataset.category = character.category;
  card.dataset.search = `${character.name} ${character.category} ${character.folder}`.toLowerCase();
  card.title = 'Drag onto the stage, or double-click to place';
  card.setAttribute('aria-label', character.name);
  const image = document.createElement('img');
  image.alt = character.name;
  image.draggable = false;
  image.loading = 'lazy';
  image.src = rocketboxUrl(thumbnailPath(character.id, character.folder));
  const title = document.createElement('span');
  title.textContent = character.name;
  const meta = document.createElement('small');
  meta.textContent = `${character.category} · ${character.gender}`;
  card.append(image, title, meta);
  card.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData('application/x-rocketbox', character.id);
    event.dataTransfer?.setData('text/plain', character.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
  });
  card.addEventListener('dblclick', () => {
    void place(character.id, stage.nextPoint());
  });
  libraryList.appendChild(card);
}

const preferredGroups = ['idle', 'walk', 'run', 'turn', 'sit', 'crouch', 'gestic', 'dancing'];
const groups = [...new Set(catalog.animations.map((animation) => animation.group))].sort((a, b) => {
  const ai = preferredGroups.indexOf(a);
  const bi = preferredGroups.indexOf(b);
  if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  return a.localeCompare(b);
});
addOption(groupSelect, 'all', 'All groups');
for (const group of groups) addOption(groupSelect, group, titleCase(group));

type AnimClip = { id: string; label: string; group: string };
type AnimNode = { name: string; clips: AnimClip[]; children: Map<string, AnimNode> };

const animationTree: AnimNode = { name: '', clips: [], children: new Map() };
for (const animation of catalog.animations) {
  const parts = animation.label.toLowerCase().split(/[\s_]+/).filter(Boolean);
  let node = animationTree;
  for (const part of parts) {
    let child = node.children.get(part);
    if (!child) {
      child = { name: part, clips: [], children: new Map() };
      node.children.set(part, child);
    }
    node = child;
  }
  node.clips.push({ id: animation.id, label: animation.label, group: animation.group });
}
for (const node of animationTree.children.values()) animList.appendChild(renderAnimationNode(node));

function renderAnimationNode(node: AnimNode): HTMLElement {
  const folders = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (folders.length === 0 && node.clips.length === 1) return clipRow(node.clips[0]);

  const branch = document.createElement('details');
  branch.className = 'anim-branch';
  const summary = document.createElement('summary');
  const twist = document.createElement('span');
  twist.className = 'twist';
  twist.setAttribute('aria-hidden', 'true');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.ariaLabel = `Include every ${titleCase(node.name)} clip in the GLB`;
  box.addEventListener('mousedown', (event) => event.stopPropagation());
  box.addEventListener('click', (event) => event.stopPropagation());
  box.addEventListener('change', () => {
    const ids = [...branch.querySelectorAll<HTMLElement>('.anim[data-id]')]
      .filter((row) => !row.hidden)
      .map((row) => row.dataset.id ?? '')
      .filter(Boolean);
    toggleClips(ids, box.checked);
  });
  const title = document.createElement('span');
  title.textContent = titleCase(node.name);
  summary.append(twist, box, title);
  const children = document.createElement('div');
  children.className = 'anim-children';
  for (const clip of node.clips) children.appendChild(clipRow(clip));
  for (const folder of folders) children.appendChild(renderAnimationNode(folder));
  branch.append(summary, children);
  return branch;
}

function clipRow(clip: AnimClip): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = 'anim';
  row.dataset.id = clip.id;
  row.dataset.group = clip.group;
  row.dataset.label = clip.label.toLowerCase();
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.ariaLabel = `Include ${clip.label} in the GLB`;
  box.addEventListener('change', () => toggleClips([clip.id], box.checked));
  const button = document.createElement('button');
  button.type = 'button';
  const leaf = clip.label.split(/[\s_]+/).pop() ?? clip.label;
  button.textContent = clip.group === 'file' ? clip.label : titleCase(leaf);
  if (clip.group === 'file') button.title = clip.label;
  button.addEventListener('click', () => {
    void play(clip.id);
  });
  row.append(box, button);
  return row;
}

function toggleClips(ids: string[], checked: boolean) {
  const actor = stage.selected;
  if (!actor) {
    setStatus('Select a character on the stage first.');
    syncStage();
    return;
  }
  if (ids.length === 0) return;
  if (checked) {
    for (const id of ids) actor.checked.add(id);
    syncStage();
    void play(ids[0]);
  } else {
    for (const id of ids) actor.checked.delete(id);
    syncStage();
    if (actor.playingId && ids.includes(actor.playingId)) stopClip();
  }
}

librarySearch.addEventListener('input', filterLibrary);
animSearch.addEventListener('input', filterAnimations);
animSelectAll.addEventListener('change', () => {
  toggleClips(visibleAnimIds(), animSelectAll.checked);
});
meshSearch.addEventListener('input', filterMeshes);
groupSelect.addEventListener('change', filterAnimations);
motionSelect.addEventListener('change', () => {
  motion = motionSelect.value as Motion;
  const playing = stage.selected?.playingId;
  if (playing) void play(playing);
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
  button.addEventListener('click', () => {
    const mode = button.dataset.mode;
    if (mode === 'translate' || mode === 'rotate' || mode === 'scale') stage.setMode(mode);
  });
}
required<HTMLButtonElement>('#stop-clip').addEventListener('click', stopClip);
required<HTMLButtonElement>('#fit-body').addEventListener('click', () => {
  if (!stage.fitSelected('body')) setStatus('Select a character on the stage first.');
});
required<HTMLButtonElement>('#fit-face').addEventListener('click', () => {
  if (!stage.selected) setStatus('Select a character on the stage first.');
  else if (!stage.fitSelected('face')) setStatus('This character has no head bone to frame.');
});
required<HTMLButtonElement>('#copy-animations').addEventListener('click', copyAnimations);
required<HTMLButtonElement>('#paste-animations').addEventListener('click', () => void pasteAnimations());
required<HTMLButtonElement>('#remove-actor').addEventListener('click', () => stage.deleteSelected());
exportSelected.addEventListener('click', () => void exportActors('selected'));
exportStage.addEventListener('click', () => void exportActors('stage'));
importButton.addEventListener('click', () => {
  importFile.value = '';
  importFile.click();
});
importFile.addEventListener('change', () => {
  const files = [...importFile.files ?? []];
  if (files.length === 0) return;
  void importFiles(files);
});

stageElement.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  stageElement.classList.add('dropping');
});
stageElement.addEventListener('dragleave', (event) => {
  if (event.relatedTarget instanceof Node && stageElement.contains(event.relatedTarget)) return;
  stageElement.classList.remove('dropping');
});
stageElement.addEventListener('drop', (event) => {
  event.preventDefault();
  stageElement.classList.remove('dropping');
  const transfer = event.dataTransfer;
  const id = transfer?.getData('application/x-rocketbox') || transfer?.getData('text/plain') || '';
  if (charactersById.has(id)) {
    void place(id, stage.groundPoint(event.clientX, event.clientY));
    return;
  }
  const files = [...transfer?.files ?? []];
  if (files.length > 0) {
    void importFiles(files);
    return;
  }
  reportImport('Drop a character from the library, or a GLB, VRM, OBJ, or other model file.');
});

window.addEventListener('keydown', (event) => {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (event.key === 'Delete' || event.key === 'Backspace') stage.deleteSelected();
  else if (event.key === 'g' || event.key === 'G') stage.setMode('translate');
  else if (event.key === 'r' || event.key === 'R') stage.setMode('rotate');
  else if (event.key === 's' || event.key === 'S') stage.setMode('scale');
  else if (event.key === 'f' || event.key === 'F') {
    if (event.shiftKey) {
      if (stage.selected && !stage.fitSelected('face')) setStatus('This character has no head bone to frame.');
    } else stage.fitSelected('body');
  }
  else if (event.key === 'Escape') stage.deselect();
});

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) {
    if (speaker.speaking) {
      speaker.stop();
      setStatus('Stopped.');
      syncChat();
    }
    return;
  }
  const actor = stage.selected;
  if (!actor) {
    setStatus('Select a character on the stage first.');
    return;
  }
  const imported = actor.category === 'Import';
  const gesture = imported ? null : chooseTalkGesture(text, actor.gender);
  if (gesture) beginTalk(actor, gesture.id);
  const voiced = speaker.say(actor, text, actor.gender);
  chatInput.value = '';
  const mouth = hasJaw(actor.face) ? '' : ' This model has no jaw bone, so the mouth stays still.';
  const audio = voiced === 'audio' ? '' : ' This browser has no speech synthesis, so only the mouth moves.';
  const lead = gesture ? `${actor.label} · ${titleCase(gesture.label)}: ${text}` : `${actor.label}: ${text}`;
  setStatus(`${lead}${mouth}${audio}`);
  syncChat();
});
chatInput.addEventListener('input', syncChat);
chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});
stage.onFrame = () => {
  const shape = speaker.sample();
  for (const actor of stage.actors) actor.mouth = actor === speaker.target && shape ? shape : null;
  if (speaker.speaking === wasSpeaking) return;
  const ended = wasSpeaking && !speaker.speaking;
  wasSpeaking = speaker.speaking;
  if (ended) endTalk();
  syncChat();
};
stage.onChange = () => {
  if (speaker.target && !stage.actors.includes(speaker.target)) speaker.stop();
  syncStage();
};
filterLibrary();
filterAnimations();
syncStage();

async function importFiles(files: File[]) {
  importButton.disabled = true;
  beginLoad('Importing…');
  setStatus('Importing…');
  let failure = '';
  try {
    const imported = await importModelFiles(files);
    const notes: string[] = [];
    for (const model of imported) {
      const id = `import/${model.label}`;
      const placed = stage.actors.filter((actor) => actor.characterId === id).length + 1;
      const label = placed === 1 ? model.label : `${model.label} ${placed}`;
      stage.add(model.group, {
        characterId: id,
        label,
        gender: model.gender,
        category: 'Import',
      }, stage.nextPoint());
      stage.fitSelected('body');
      notes.push(`${label} is on the stage. ${importNote(model)}`);
    }
    setStatus(notes.join(' '));
    syncStage();
  } catch (error) {
    failure = error instanceof Error ? error.message : 'Could not import that file.';
    setStatus(failure);
  } finally {
    importButton.disabled = false;
    endLoad();
    if (failure) reportImport(failure);
  }
}

function reportImport(message: string) {
  setStatus(message);
  stageChip.hidden = false;
  stageChip.textContent = message;
}

function importNote(model: ImportedModel): string {
  if (model.clips === 0) return 'This file has no animations.';
  const noun = model.clips === 1 ? 'animation' : 'animations';
  return `${model.clips} ${noun} came with the file.`;
}

async function place(id: string, point: import('three').Vector3) {
  const character = charactersById.get(id);
  if (!character) return;
  beginLoad(`Loading ${character.name}…`);
  setStatus(`Loading ${character.name}. The first load pulls the mesh and color textures from GitHub.`);
  try {
    const template = await loadTemplate(character);
    const placed = stage.actors.filter((actor) => actor.characterId === id).length + 1;
    const label = placed === 1 ? character.name : `${character.name} ${placed}`;
    stage.add(cloneTemplate(template), {
      characterId: character.id,
      label,
      gender: character.gender,
      category: character.category,
    }, point);
    setStatus(`${label} is on the stage.`);
    syncStage();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Could not load that character.');
  } finally {
    endLoad();
  }
}

let playToken = 0;
let talkSerial = 0;
let talkActor: StageActor | null = null;
let talkClipId: string | null = null;

function beginTalk(actor: StageActor, animationId: string) {
  const serial = ++talkSerial;
  const token = ++playToken;
  void runTalk(actor, animationId, serial, token);
}

async function runTalk(actor: StageActor, animationId: string, serial: number, token: number) {
  const animation = animationsById.get(animationId);
  if (!animation) return;
  const resolved = resolveAnimation(animation, actor.gender, 'static');
  if (!resolved) return;
  try {
    const result = await loadRetargetedClip(resolved.path, actor.object, animation.id);
    if (serial !== talkSerial || token !== playToken) return;
    if (!speaker.speaking || speaker.target !== actor || !stage.actors.includes(actor)) return;
    actor.mixer.stopAllAction();
    const action = actor.mixer.clipAction(result.clip);
    action.setLoop(LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.enabled = true;
    action.reset().play();
    actor.playingId = animation.id;
    talkActor = actor;
    talkClipId = animation.id;
    syncStage();
  } catch (error) {
    if (serial !== talkSerial) return;
    setStatus(error instanceof Error ? error.message : 'Could not load the talk gesture.');
  }
}

function endTalk() {
  talkSerial += 1;
  const actor = talkActor;
  const id = talkClipId;
  talkActor = null;
  talkClipId = null;
  if (!actor || !stage.actors.includes(actor) || actor.playingId !== id) return;
  playToken += 1;
  actor.mixer.stopAllAction();
  stage.restoreRest(actor);
  actor.playingId = null;
  syncStage();
}

async function play(animationId: string) {
  const token = ++playToken;
  const actor = stage.selected;
  if (!actor) {
    setStatus('Select a character on the stage first.');
    return;
  }
  if (ownClips(actor).some((clip) => clip.uuid === animationId)) {
    playFileClip(actor, animationId);
    return;
  }
  const animation = animationsById.get(animationId);
  if (!animation) return;
  const resolved = resolveAnimation(animation, actor.gender, motion);
  if (!resolved) {
    setStatus(`No file for ${animation.label}.`);
    return;
  }
  setStatus(`Loading ${titleCase(animation.label)}…`);
  try {
    const result = await loadRetargetedClip(resolved.path, actor.object, animation.id);
    if (token !== playToken || stage.selected !== actor) return;
    actor.mixer.stopAllAction();
    const action = actor.mixer.clipAction(result.clip);
    const style = loopStyle(animation.id);
    action.setLoop(style.loop, style.repetitions);
    action.clampWhenFinished = style.clamp;
    action.enabled = true;
    action.reset().play();
    actor.playingId = animation.id;
    stage.ensureVisible();
    syncStage();
    const notes = [];
    if (resolved.gender !== actor.gender || resolved.motion !== motion) {
      notes.push(`using the ${resolved.gender} ${motionLabel(resolved.motion)} file`);
    }
    if (result.matched < 12) notes.push('only a few bones matched');
    const extra = notes.length ? ` (${notes.join('; ')})` : '';
    setStatus(`Playing ${titleCase(animation.label)}${extra}.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Could not load that animation.');
  }
}

function playFileClip(actor: StageActor, animationId: string) {
  const clip = ownClips(actor).find((item) => item.uuid === animationId);
  if (!clip) {
    setStatus('That animation is not in this file.');
    return;
  }
  actor.mixer.stopAllAction();
  const action = actor.mixer.clipAction(clip);
  action.setLoop(LoopRepeat, Infinity);
  action.clampWhenFinished = false;
  action.enabled = true;
  action.reset().play();
  actor.playingId = clip.uuid;
  stage.ensureVisible();
  syncStage();
  setStatus(`Playing ${clip.name || 'clip'}.`);
}

function ownClips(actor: StageActor): AnimationClip[] {
  const clips: AnimationClip[] = [];
  const seen = new Set<AnimationClip>();
  const take = (list?: AnimationClip[]) => {
    for (const clip of list ?? []) {
      if (seen.has(clip)) continue;
      seen.add(clip);
      clips.push(clip);
    }
  };
  take(actor.object.animations);
  actor.object.traverse((object) => take(object.animations));
  return clips;
}

function copyAnimations() {
  const actor = stage.selected;
  if (!actor) {
    setStatus('Select a character on the stage first.');
    return;
  }
  const ids = [...actor.checked];
  const playingId = actor.playingId;
  if (ids.length === 0 && !playingId) {
    setStatus('Check clips, or play one, before copying.');
    return;
  }
  const fileClips = actor.category === 'Import' ? copiedFileClips(actor, ids, playingId) : null;
  animationClipboard = { ids, playingId, fileClips };
  syncStage();
  const count = ids.length || 1;
  setStatus(`Copied ${count} animation${count === 1 ? '' : 's'} from ${actor.label}.`);
}

function copiedFileClips(actor: StageActor, ids: string[], playingId: string | null): CopiedFileClip[] {
  return ownClips(actor)
    .filter((clip) => ids.includes(clip.uuid) || clip.uuid === playingId)
    .map((clip) => ({
      clip: clip.clone(),
      checked: ids.includes(clip.uuid),
      playing: clip.uuid === playingId,
    }));
}

async function pasteAnimations() {
  const actor = stage.selected;
  const copied = animationClipboard;
  if (!actor || !copied) return;
  if (copied.fileClips) {
    await pasteFileClips(actor, copied.fileClips);
    return;
  }
  if (actor.category === 'Import') return;
  actor.checked = new Set(copied.ids);
  if (copied.playingId) {
    await play(copied.playingId);
    if (stage.selected !== actor || actor.playingId !== copied.playingId) return;
  } else {
    playToken += 1;
    actor.mixer.stopAllAction();
    stage.restoreRest(actor);
    actor.playingId = null;
    syncStage();
  }
  const count = copied.ids.length || 1;
  setStatus(`Pasted ${count} animation${count === 1 ? '' : 's'} onto ${actor.label}.`);
}

async function pasteFileClips(actor: StageActor, items: CopiedFileClip[]) {
  const checkedIds: string[] = [];
  let playingId: string | null = null;
  for (const item of items) {
    let clip = ownClips(actor).find((existing) => existing.name === item.clip.name && existing.duration === item.clip.duration);
    if (!clip) {
      clip = item.clip.clone();
      actor.object.animations.push(clip);
    }
    if (item.checked) checkedIds.push(clip.uuid);
    if (item.playing) playingId = clip.uuid;
  }
  actor.checked = new Set(checkedIds);
  if (playingId) {
    await play(playingId);
    if (stage.selected !== actor || actor.playingId !== playingId) return;
  } else {
    playToken += 1;
    actor.mixer.stopAllAction();
    stage.restoreRest(actor);
    actor.playingId = null;
    syncStage();
  }
  const count = checkedIds.length || items.length;
  setStatus(`Pasted ${count} animation${count === 1 ? '' : 's'} onto ${actor.label}.`);
}

function stopClip() {
  playToken += 1;
  const actor = stage.selected;
  if (!actor) return;
  actor.mixer.stopAllAction();
  stage.restoreRest(actor);
  actor.playingId = null;
  syncStage();
  setStatus('Returned to the standing pose.');
}

async function exportActors(which: 'selected' | 'stage') {
  const actors = which === 'selected' ? (stage.selected ? [stage.selected] : []) : [...stage.actors];
  if (actors.length === 0) {
    setStatus(which === 'selected' ? 'Select a character to export.' : 'Place a character before exporting the stage.');
    return;
  }
  exportSelected.disabled = true;
  exportStage.disabled = true;
  setStatus('Preparing the GLB…');
  try {
    const clips: AnimationClip[][] = [];
    for (const actor of actors) clips.push(await collectClips(actor));
    const filename = which === 'selected' ? `${fileSlug(actors[0].label)}.glb` : 'rocketbox-stage.glb';
    await exportGlb(actors.map((actor) => actor.object), clips, filename);
    const clipCount = clips.reduce((total, list) => total + list.length, 0);
    setStatus(`Exported ${filename} with ${actors.length} model${actors.length === 1 ? '' : 's'} and ${clipCount} animation clip${clipCount === 1 ? '' : 's'}.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Export failed.');
  } finally {
    syncStage();
  }
}

async function collectClips(actor: StageActor): Promise<AnimationClip[]> {
  const ids = [...actor.checked];
  if (ids.length === 0 && actor.playingId) ids.push(actor.playingId);
  if (actor.category === 'Import') {
    return ownClips(actor).filter((clip) => ids.includes(clip.uuid)).map((clip) => clip.clone());
  }
  const clips: AnimationClip[] = [];
  for (const id of ids) {
    const animation = animationsById.get(id);
    if (!animation) continue;
    const resolved = resolveAnimation(animation, actor.gender, motion);
    if (!resolved) continue;
    const result = await loadRetargetedClip(resolved.path, actor.object, animation.id);
    if (result.matched === 0) continue;
    const named = result.clip.clone();
    const motionNote = resolved.motion === 'static' ? '' : ` (${motionLabel(resolved.motion)})`;
    named.name = `${actor.label} - ${titleCase(animation.label)}${motionNote}`;
    clips.push(named);
  }
  for (const clip of ownClips(actor)) {
    if (ids.includes(clip.uuid)) clips.push(clip.clone());
  }
  return clips;
}

function syncStage() {
  const count = stage.actors.length;
  stageCount.textContent = count === 0 ? 'Stage empty' : `${count} on stage`;
  stageHint.hidden = count > 0;
  exportSelected.disabled = stage.selected === null;
  exportStage.disabled = count === 0;
  const nothingSelected = stage.selected === null;
  required<HTMLButtonElement>('#fit-body').disabled = nothingSelected;
  required<HTMLButtonElement>('#fit-face').disabled = nothingSelected;
  const imported = stage.selected?.category === 'Import';
  const hasAnimations = (stage.selected?.checked.size ?? 0) > 0 || stage.selected?.playingId != null;
  required<HTMLButtonElement>('#copy-animations').disabled = !hasAnimations;
  const pasteCatalogOntoImport = animationClipboard != null && animationClipboard.fileClips == null && imported === true;
  required<HTMLButtonElement>('#paste-animations').disabled = nothingSelected || animationClipboard == null || pasteCatalogOntoImport;
  syncChat();
  const actor = stage.selected;
  selectionMeta.textContent = actor
    ? `${actor.label} · ${actor.category} · ${actor.gender} · ${actor.height.toFixed(2)} m`
    : 'Select a character on the stage.';
  syncFileAnims(actor);
  syncMeshTree(actor);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
    button.setAttribute('aria-pressed', button.dataset.mode === stage.getMode() ? 'true' : 'false');
  }
  for (const row of document.querySelectorAll<HTMLElement>('#anim-list .anim[data-id], #file-anims .anim[data-id]')) {
    const id = row.dataset.id ?? '';
    const box = row.querySelector('input');
    if (box) {
      box.checked = actor?.checked.has(id) ?? false;
      box.indeterminate = false;
      box.disabled = actor === null;
    }
    row.classList.toggle('playing', actor?.playingId === id);
  }
  for (const branch of animList.querySelectorAll<HTMLDetailsElement>('details.anim-branch')) {
    const boxes = [...branch.querySelectorAll<HTMLElement>('.anim[data-id]')]
      .filter((row) => !row.hidden)
      .map((row) => row.querySelector('input'))
      .filter((box): box is HTMLInputElement => box !== null);
    const head = branch.querySelector<HTMLInputElement>(':scope > summary input');
    if (!head) continue;
    const checked = boxes.filter((box) => box.checked).length;
    head.disabled = actor === null;
    head.checked = boxes.length > 0 && checked === boxes.length;
    head.indeterminate = checked > 0 && checked < boxes.length;
  }
  syncAnimSelectAll();
  syncExportPanel();
}

function syncExportPanel() {
  const facts = required<HTMLElement>('#export-facts');
  facts.replaceChildren();
  const actor = stage.selected;
  if (!actor) {
    addFact(facts, 'Model', 'None selected');
    return;
  }
  const stats = measureModel(actor.object);
  const clips = clipsForExport(actor);
  const included = clips.length === 0 && actor.playingId ? [actor.playingId] : clips;
  addFact(facts, 'Model', actor.label);
  addFact(facts, 'Polygons', formatCount(stats.triangles));
  addFact(facts, 'Vertices', formatCount(stats.vertices));
  addFact(facts, 'Meshes', formatCount(stats.meshes));
  addFact(facts, 'Bones', formatCount(stats.bones));
  addFact(facts, 'Textures', stats.textures === 0 ? '0' : `${stats.textures} · 1024`);
  const clipLabel = clips.length > 0
    ? `${clips.length} checked`
    : included.length > 0
      ? '1 playing'
      : '0';
  addFact(facts, 'Animations', clipLabel);
  if (included.length > 0) {
    const names = document.createElement('ul');
    const shown = included.slice(0, 4);
    for (const id of shown) {
      const item = document.createElement('li');
      item.textContent = titleCase(animationsById.get(id)?.label ?? clipName(actor, id) ?? id);
      names.appendChild(item);
    }
    if (included.length > shown.length) {
      const more = document.createElement('li');
      more.textContent = `+ ${included.length - shown.length} more`;
      names.appendChild(more);
    }
    const row = document.createElement('div');
    const term = document.createElement('dt');
    const value = document.createElement('dd');
    value.appendChild(names);
    row.append(term, value);
    facts.appendChild(row);
  }
  const size = document.createElement('dd');
  size.textContent = `about ${formatBytes(estimateExportBytes(stats, included.length))}`;
  size.className = 'estimate';
  size.title = 'Estimate from the mesh, 1024 textures, and clip count. The saved GLB can differ.';
  const sizeRow = document.createElement('div');
  const sizeTerm = document.createElement('dt');
  sizeTerm.textContent = 'File size';
  sizeRow.append(sizeTerm, size);
  facts.appendChild(sizeRow);
}

function clipsForExport(actor: StageActor): string[] {
  const own = new Set(ownClips(actor).map((clip) => clip.uuid));
  return [...actor.checked].filter((id) => own.has(id) || animationsById.has(id));
}

function clipName(actor: StageActor, id: string): string | null {
  return ownClips(actor).find((clip) => clip.uuid === id)?.name ?? null;
}

function syncFileAnims(actor: StageActor | null) {
  const imported = actor?.category === 'Import';
  animList.hidden = imported === true;
  animFilters.hidden = imported === true;
  const clips = actor ? ownClips(actor) : [];
  const showFile = imported || clips.length > 0;
  fileAnims.hidden = !showFile;
  if (!actor || !showFile) {
    fileActorId = '';
    fileAnims.replaceChildren();
    if (!imported) filterAnimations();
    return;
  }
  const signature = `${actor.uid}:${clips.map((clip) => clip.uuid).join('|')}`;
  if (signature !== fileActorId) {
    fileActorId = signature;
    renderFileAnims(actor);
  }
  if (imported) filterFileAnims();
  else filterAnimations();
}

function renderFileAnims(actor: StageActor) {
  fileAnims.replaceChildren();
  const clips = ownClips(actor);
  if (clips.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'note';
    empty.textContent = 'This file has no animations.';
    fileAnims.append(empty);
    return;
  }
  for (const clip of clips) fileAnims.append(clipRow({ id: clip.uuid, label: clip.name || 'Clip', group: 'file' }));
}

function filterFileAnims() {
  const query = animSearch.value.trim().toLowerCase();
  let shown = 0;
  for (const row of fileAnims.querySelectorAll<HTMLElement>('.anim[data-id]')) {
    const visible = (row.dataset.label ?? '').includes(query);
    row.hidden = !visible;
    if (visible) shown += 1;
  }
  animCount.textContent = shown === 0 ? 'No animations in this file' : `${shown} clip${shown === 1 ? '' : 's'} in this file`;
  syncAnimSelectAll();
}

type MeshWord = { name: string; meshes: Mesh[]; children: Map<string, MeshWord> };

function syncMeshTree(actor: StageActor | null) {
  const id = actor?.uid ?? '';
  if (id === meshActorId) {
    filterMeshes();
    return;
  }
  meshActorId = id;
  meshSearch.value = '';
  meshList.replaceChildren();
  if (!actor) {
    meshCount.textContent = 'Select a character.';
    return;
  }
  const meshes: Mesh[] = [];
  actor.object.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh) meshes.push(mesh);
  });
  const tree = meshWordTree(meshes);
  const branches = [...tree.children.values()].sort(byMeshWord);
  if (branches.length === 0 && tree.meshes.length === 0) {
    meshCount.textContent = 'No meshes.';
    return;
  }
  for (const mesh of tree.meshes) meshList.append(meshRow(mesh, mesh.name || 'Mesh'));
  for (const branch of branches) meshList.append(renderMeshWord(branch));
  refreshMeshFolders();
  filterMeshes();
}

function meshWordTree(meshes: Mesh[]): MeshWord {
  const root: MeshWord = { name: '', meshes: [], children: new Map() };
  for (const mesh of meshes) {
    let node = root;
    for (const word of meshWords(mesh.name || 'Mesh')) {
      const key = word.toLowerCase();
      let child = node.children.get(key);
      if (!child) {
        child = { name: word, meshes: [], children: new Map() };
        node.children.set(key, child);
      }
      node = child;
    }
    node.meshes.push(mesh);
  }
  return root;
}

function meshWords(name: string): string[] {
  const words: string[] = [];
  for (const chunk of name.trim().split(/[^A-Za-z0-9]+/)) {
    if (!chunk) continue;
    const parts = chunk.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g);
    words.push(...(parts && parts.length > 0 ? parts : [chunk]));
  }
  return words.length > 0 ? words : ['Mesh'];
}

function byMeshWord(a: MeshWord, b: MeshWord): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true });
}

function renderMeshWord(node: MeshWord): HTMLElement {
  const folders = [...node.children.values()].sort(byMeshWord);
  if (folders.length === 0 && node.meshes.length === 1) {
    return meshRow(node.meshes[0], titleCase(node.name));
  }
  const branch = document.createElement('details');
  branch.className = 'anim-branch';
  branch.open = true;
  const summary = document.createElement('summary');
  const twist = document.createElement('span');
  twist.className = 'twist';
  twist.setAttribute('aria-hidden', 'true');
  const box = document.createElement('input');
  box.type = 'checkbox';
  const label = titleCase(node.name);
  box.ariaLabel = `Show every ${label} mesh`;
  box.addEventListener('mousedown', (event) => event.stopPropagation());
  box.addEventListener('click', (event) => event.stopPropagation());
  box.addEventListener('change', () => {
    for (const mesh of meshesIn(branch)) mesh.visible = box.checked;
    for (const input of branch.querySelectorAll<HTMLInputElement>('input[data-uuid]')) {
      input.checked = box.checked;
      input.indeterminate = false;
    }
    refreshMeshFolders();
    filterMeshes();
    syncExportPanel();
  });
  const title = document.createElement('span');
  title.textContent = label;
  summary.append(twist, box, title);
  const children = document.createElement('div');
  children.className = 'anim-children mesh-children';
  for (const mesh of node.meshes) children.append(meshRow(mesh, mesh.name || label));
  for (const folder of folders) children.append(renderMeshWord(folder));
  branch.append(summary, children);
  return branch;
}

function meshRow(mesh: Mesh, label: string): HTMLElement {
  const row = document.createElement('label');
  row.className = 'mesh';
  const name = mesh.name || label;
  row.dataset.name = name.toLowerCase();
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.dataset.uuid = mesh.uuid;
  box.checked = mesh.visible;
  box.ariaLabel = `Show ${name}`;
  box.addEventListener('change', () => {
    mesh.visible = box.checked;
    refreshMeshFolders();
    filterMeshes();
    syncExportPanel();
  });
  const title = document.createElement('span');
  title.textContent = label;
  title.title = name;
  row.append(box, title);
  return row;
}

function meshesIn(root: ParentNode): Mesh[] {
  const meshes: Mesh[] = [];
  for (const box of root.querySelectorAll<HTMLInputElement>('input[data-uuid]')) {
    const mesh = meshFor(box.dataset.uuid ?? '');
    if (mesh) meshes.push(mesh);
  }
  return meshes;
}

function meshFor(uuid: string): Mesh | null {
  for (const actor of stage.actors) {
    let found: Mesh | null = null;
    actor.object.traverse((object) => {
      const mesh = object as Mesh;
      if (!found && mesh.isMesh && mesh.uuid === uuid) found = mesh;
    });
    if (found) return found;
  }
  return null;
}

function refreshMeshFolders() {
  for (const branch of meshList.querySelectorAll<HTMLDetailsElement>('details.anim-branch')) {
    const head = branch.querySelector<HTMLInputElement>(':scope > summary input');
    const leaves = [...branch.querySelectorAll<HTMLInputElement>('input[data-uuid]')];
    if (!head) continue;
    const enabled = leaves.filter((box) => box.checked).length;
    head.checked = leaves.length > 0 && enabled === leaves.length;
    head.indeterminate = enabled > 0 && enabled < leaves.length;
  }
}

function filterMeshes() {
  const query = meshSearch.value.trim().toLowerCase();
  for (const row of meshList.querySelectorAll<HTMLElement>('.mesh')) {
    row.hidden = query.length > 0 && !(row.dataset.name ?? '').includes(query);
  }
  for (const branch of meshList.querySelectorAll<HTMLDetailsElement>('details.anim-branch')) {
    const shown = [...branch.querySelectorAll<HTMLElement>('.mesh')].some((row) => !row.hidden);
    branch.hidden = !shown;
    if (query && shown) branch.open = true;
  }
  const rows = [...meshList.querySelectorAll<HTMLElement>('.mesh')];
  const matched = rows.filter((row) => !row.hidden);
  const enabled = matched.filter((row) => row.querySelector('input')?.checked).length;
  if (rows.length === 0) return;
  meshCount.textContent = query.length > 0
    ? `${matched.length} mesh${matched.length === 1 ? '' : 'es'} match`
    : `${enabled} of ${rows.length} meshes`;
}

function shownInExport(object: Object3D): boolean {
  let current: Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

type ModelMeasure = {
  triangles: number;
  vertices: number;
  meshes: number;
  bones: number;
  textures: number;
};

function measureModel(root: Object3D): ModelMeasure {
  let triangles = 0;
  let vertices = 0;
  let meshes = 0;
  const skeletons = new Set<object>();
  const textures = new Set<Texture>();
  let bones = 0;
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.geometry || !shownInExport(mesh)) return;
    meshes += 1;
    const position = mesh.geometry.getAttribute('position');
    const count = position?.count ?? 0;
    vertices += count;
    triangles += mesh.geometry.index ? mesh.geometry.index.count / 3 : count / 3;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const map = (material as { map?: Texture | null }).map;
      if (map) textures.add(map);
    }
    const skinned = object as SkinnedMesh;
    if (skinned.isSkinnedMesh && !skeletons.has(skinned.skeleton)) {
      skeletons.add(skinned.skeleton);
      bones += skinned.skeleton.bones.length;
    }
  });
  return { triangles, vertices, meshes, bones, textures: textures.size };
}

function estimateExportBytes(stats: ModelMeasure, clips: number): number {
  const geometry = stats.vertices * 32 + stats.triangles * 6;
  const textures = stats.textures * 700_000;
  const animations = clips * 220_000;
  return geometry + textures + animations + 12_000;
}

function addFact(list: HTMLElement, label: string, value: string) {
  const row = document.createElement('div');
  const term = document.createElement('dt');
  term.textContent = label;
  const data = document.createElement('dd');
  data.textContent = value;
  row.append(term, data);
  list.appendChild(row);
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const megabytes = bytes / (1024 * 1024);
  return megabytes < 10 ? `${megabytes.toFixed(1)} MB` : `${Math.round(megabytes)} MB`;
}

function filterLibrary() {
  const query = librarySearch.value.trim().toLowerCase();
  let shown = 0;
  for (const card of libraryList.querySelectorAll<HTMLElement>('.card')) {
    const visible = (category === 'All' || card.dataset.category === category) && (card.dataset.search ?? '').includes(query);
    card.hidden = !visible;
    if (visible) shown += 1;
  }
  libraryCount.textContent = shown === catalog.characters.length ? '115 characters' : `${shown} of 115`;
}

function filterAnimations() {
  if (stage.selected?.category === 'Import') {
    filterFileAnims();
    return;
  }
  const query = animSearch.value.trim().toLowerCase();
  const group = groupSelect.value;
  let shown = 0;
  for (const row of animList.querySelectorAll<HTMLElement>('.anim[data-id]')) {
    const visible = (group === 'all' || row.dataset.group === group) && (row.dataset.label ?? '').includes(query);
    row.hidden = !visible;
    if (visible) shown += 1;
  }
  for (const branch of animList.querySelectorAll<HTMLDetailsElement>('details.anim-branch')) {
    const visible = [...branch.querySelectorAll<HTMLElement>('.anim[data-id]')].some((row) => !row.hidden);
    branch.hidden = !visible;
    if (query && visible) branch.open = true;
  }
  if (!fileAnims.hidden && stage.selected?.category !== 'Import') {
    for (const row of fileAnims.querySelectorAll<HTMLElement>('.anim[data-id]')) {
      row.hidden = !(row.dataset.label ?? '').includes(query);
    }
  }
  animCount.textContent = `${shown} clips`;
  syncAnimSelectAll();
}

function visibleAnimRows(): HTMLElement[] {
  return [animList, fileAnims]
    .filter((list) => !list.hidden)
    .flatMap((list) => [...list.querySelectorAll<HTMLElement>('.anim[data-id]')].filter((row) => !row.hidden));
}

function visibleAnimIds(): string[] {
  return visibleAnimRows().map((row) => row.dataset.id ?? '').filter(Boolean);
}

function syncAnimSelectAll() {
  const boxes = visibleAnimRows()
    .map((row) => row.querySelector('input'))
    .filter((box): box is HTMLInputElement => box !== null);
  const checked = boxes.filter((box) => box.checked).length;
  animSelectAll.disabled = stage.selected === null || boxes.length === 0;
  animSelectAll.checked = boxes.length > 0 && checked === boxes.length;
  animSelectAll.indeterminate = checked > 0 && checked < boxes.length;
}

function beginLoad(text: string) {
  loads += 1;
  stageChip.hidden = false;
  stageChip.textContent = text;
}

function endLoad() {
  loads = Math.max(0, loads - 1);
  stageChip.hidden = loads === 0;
}

function syncChat() {
  const text = chatInput.value.trim();
  const speaking = speaker.speaking;
  chatSend.textContent = speaking && text === '' ? 'Stop' : 'Send';
  chatSend.disabled = !speaking && (text === '' || stage.selected === null);
}

function setStatus(text: string) {
  status.textContent = text;
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function fileSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character';
}

function addOption(select: HTMLSelectElement, value: string, label: string) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}
