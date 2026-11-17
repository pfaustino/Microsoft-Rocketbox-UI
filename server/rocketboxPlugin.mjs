import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tgaToPng } from './tga.mjs';
import { synthesizeWav, warmTts } from './tts.mjs';

const ORIGIN = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/';
const TEXTURE_EDGE = 1024;
const inflight = new Map();

export function rocketboxPlugin() {
  const root = path.resolve('.cache/rocketbox');
  return {
    name: 'rocketbox-proxy',
    configureServer(server) {
      warmTts();
      server.middlewares.use(handler(root));
    },
    configurePreviewServer(server) {
      warmTts();
      server.middlewares.use(handler(root));
    },
  };
}

function handler(root) {
  return async (req, res, next) => {
    const url = req.url ?? '';
    try {
      if (url.startsWith('/rocketbox-tts')) {
        const params = new URL(url, 'http://localhost').searchParams;
        const text = (params.get('text') ?? '').trim();
        const gender = params.get('gender') === 'male' ? 'male' : 'female';
        if (!text) return send(res, 400, 'Missing text');
        const wav = await synthesizeWav(text, gender);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Cache-Control', 'no-store');
        res.end(wav);
        return;
      }
      if (url.startsWith('/rocketbox-img/')) {
        const rel = safePath(url.slice('/rocketbox-img/'.length));
        if (!rel?.endsWith('.tga.png')) return send(res, 404, 'Not a texture');
        const png = await cachedPng(root, rel.slice(0, -4));
        res.statusCode = 200;
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.end(png);
        return;
      }
      if (url.startsWith('/rocketbox/')) {
        const rel = safePath(url.slice('/rocketbox/'.length));
        if (!rel || (!rel.endsWith('.fbx') && !rel.endsWith('.png'))) return send(res, 404, 'Unsupported file');
        const file = await cachedRaw(root, rel);
        res.statusCode = 200;
        res.setHeader('Content-Type', rel.endsWith('.png') ? 'image/png' : 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        const stream = createReadStream(file);
        stream.on('error', () => res.end());
        res.on('close', () => stream.destroy());
        stream.pipe(res);
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Asset fetch failed';
      return send(res, 502, message);
    }
    next();
  };
}

function safePath(urlPath) {
  const raw = decodeURIComponent(urlPath.split('?')[0] ?? '').replace(/^\/+/, '');
  if (!raw || raw.includes('..') || raw.includes('\\')) return null;
  if (!raw.startsWith('Assets/Avatars/') && !raw.startsWith('Assets/Animations/')) return null;
  return raw;
}

async function cachedRaw(root, rel) {
  const file = path.join(root, 'raw', rel);
  if (await exists(file)) return file;
  const key = `raw:${rel}`;
  const pending = inflight.get(key) ?? fetchRemote(rel).then(async (buf) => {
    await writeAtomic(file, buf);
    return file;
  });
  inflight.set(key, pending);
  try {
    return await pending;
  } finally {
    inflight.delete(key);
  }
}

async function cachedPng(root, tgaRel) {
  const file = path.join(root, `png${TEXTURE_EDGE}`, `${tgaRel}.png`);
  if (await exists(file)) return readFile(file);
  const key = `png:${tgaRel}`;
  const pending = inflight.get(key) ?? (async () => {
    const raw = await fetchRemote(tgaRel);
    const png = await tgaToPng(raw, TEXTURE_EDGE);
    await writeAtomic(file, png);
    return png;
  })();
  inflight.set(key, pending);
  try {
    return await pending;
  } finally {
    inflight.delete(key);
  }
}

async function fetchRemote(rel) {
  const remote = ORIGIN + rel.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(remote, {
    headers: { 'User-Agent': 'rocketbox-studio' },
    signal: AbortSignal.timeout(180000),
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${rel}`);
  return Buffer.from(await response.arrayBuffer());
}

async function writeAtomic(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.part`;
  await writeFile(temp, data);
  await rename(temp, file);
}

async function exists(file) {
  try {
    const info = await stat(file);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

function send(res, status, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(message);
}
