import { spawn } from 'node:child_process';

const SCRIPT = [
  '[Console]::InputEncoding = [System.Text.Encoding]::UTF8',
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Speech',
  '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  'while ($null -ne ($line = [Console]::In.ReadLine())) {',
  '  $req = $line | ConvertFrom-Json',
  '  try {',
  '    $gender = if ($req.gender -eq "female") { [System.Speech.Synthesis.VoiceGender]::Female } else { [System.Speech.Synthesis.VoiceGender]::Male }',
  '    $synth.SelectVoiceByHints($gender, [System.Speech.Synthesis.VoiceAge]::Adult)',
  '    $stream = New-Object System.IO.MemoryStream',
  '    $synth.SetOutputToWaveStream($stream)',
  '    $synth.Speak([string]$req.text)',
  '    $synth.SetOutputToNull()',
  '    [Console]::Out.WriteLine([Convert]::ToBase64String($stream.ToArray()))',
  '    $stream.Dispose()',
  '  } catch {',
  '    [Console]::Out.WriteLine("")',
  '  }',
  '}',
].join('\n');

let worker = null;
let chain = Promise.resolve();

function getWorker() {
  if (worker) return worker;
  const proc = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', SCRIPT],
    { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true },
  );
  let buffer = '';
  const waiters = [];
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      waiters.shift()?.resolve(line);
      newline = buffer.indexOf('\n');
    }
  });
  const reset = () => {
    if (worker?.proc === proc) worker = null;
    while (waiters.length) waiters.shift().reject(new Error('Windows speech stopped'));
  };
  proc.on('exit', reset);
  proc.on('error', reset);
  worker = { proc, waiters };
  return worker;
}

export function warmTts() {
  if (process.platform === 'win32') getWorker();
}

export function synthesizeWav(text, gender) {
  const clean = String(text ?? '').trim().slice(0, 600);
  if (!clean) return Promise.reject(new Error('Empty line'));
  if (process.platform !== 'win32') return Promise.reject(new Error('Windows speech unavailable'));
  const job = chain.then(
    () => new Promise((resolve, reject) => {
      const current = getWorker();
      current.waiters.push({
        resolve: (b64) => (b64 ? resolve(Buffer.from(b64, 'base64')) : reject(new Error('Speech produced no audio'))),
        reject,
      });
      current.proc.stdin.write(`${JSON.stringify({ text: clean, gender: gender === 'female' ? 'female' : 'male' })}\n`);
    }),
  );
  chain = job.catch(() => {});
  return job;
}
