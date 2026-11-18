// Server-side downloads for the video clipper's "paste a link" import. Each job runs yt-dlp
// into its own temporary folder; the browser polls progress, then fetches the file once.
// Files are deleted after they are served, or after 30 minutes.

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { friendlyError, parseProgress } from './videolink';

export type LinkJob = {
  id: string;
  url: string;
  status: 'downloading' | 'ready' | 'error';
  /** 0–100 for the current stream; `part` counts streams (video, then audio). */
  progress: number;
  part: number;
  title: string;
  error?: string;
  file?: string;
  size?: number;
  dir: string;
  created: number;
  proc?: ChildProcess;
};

const MAX_RUNNING = 2;
const KEEP_MS = 30 * 60 * 1000;
const FORMAT = 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b[height<=1080]/b';

// Survive Next.js dev reloads.
const g = globalThis as unknown as { __clipperJobs?: Map<string, LinkJob> };
const jobs = (g.__clipperJobs ??= new Map());

export function getJob(id: string) {
  return jobs.get(id);
}

export async function removeJob(id: string) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  job.proc?.kill('SIGKILL');
  await rm(job.dir, { recursive: true, force: true }).catch(() => {});
}

function sweep() {
  const now = Date.now();
  for (const j of jobs.values()) if (now - j.created > KEEP_MS) void removeJob(j.id);
}

export async function startJob(url: string): Promise<LinkJob> {
  sweep();
  const running = [...jobs.values()].filter((j) => j.status === 'downloading').length;
  if (running >= MAX_RUNNING) throw new Error('Two videos are already downloading. Wait for one to finish.');

  const dir = await mkdtemp(path.join(tmpdir(), 'clipper-'));
  const job: LinkJob = { id: randomUUID(), url, status: 'downloading', progress: 0, part: 1, title: '', dir, created: Date.now() };
  jobs.set(job.id, job);

  const args = [
    '--no-playlist', '--no-warnings', '--newline', '--no-simulate', '--no-mtime',
    '-f', FORMAT, '--merge-output-format', 'mp4',
    '--match-filters', 'duration<=10800 & !is_live',
    '--max-filesize', '3G',
    '--js-runtimes', 'node',
    '--print', 'before_dl:TITLE:%(title)s',
    '--progress', '--progress-template', 'download:PROGRESS:%(progress._percent_str)s',
    '-o', path.join(dir, 'video.%(ext)s'),
    '--', url,
  ];
  const bin = process.env.YTDLP_PATH || 'yt-dlp';
  let stderr = '';
  let proc: ChildProcess;
  try {
    proc = spawn(bin, args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    job.status = 'error';
    job.error = 'Link import is not set up on the server (yt-dlp is missing).';
    return job;
  }
  job.proc = proc;

  let buf = '';
  proc.stdout?.on('data', (d: Buffer) => {
    buf += d.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('TITLE:')) job.title = line.slice(6).trim();
      const p = parseProgress(line);
      if (p !== null) {
        if (p < job.progress - 50) job.part += 1; // next stream (audio after video)
        job.progress = p;
      }
    }
  });
  proc.stderr?.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-4000);
  });
  proc.on('error', (e: NodeJS.ErrnoException) => {
    job.status = 'error';
    job.error = e.code === 'ENOENT'
      ? 'Link import is not set up on the server (yt-dlp is missing).'
      : `The download could not start: ${e.message}`;
  });
  proc.on('close', async (code) => {
    job.proc = undefined;
    if (job.status === 'error') return;
    if (code !== 0) {
      job.status = 'error';
      job.error = friendlyError(stderr || 'unknown error');
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      return;
    }
    try {
      const names = (await readdir(dir)).filter((n) => /^video\.(mp4|webm|mkv|mov)$/.test(n));
      if (!names.length) throw new Error('no file');
      const file = path.join(dir, names[0]);
      job.size = (await stat(file)).size;
      job.file = file;
      job.progress = 100;
      job.status = 'ready';
    } catch {
      job.status = 'error';
      job.error = friendlyError(stderr || 'The download finished but no video file was found.');
    }
  });
  return job;
}

/** Public view of a job, safe to send to the browser. */
export function jobView(j: LinkJob) {
  return { id: j.id, status: j.status, progress: j.progress, part: j.part, title: j.title, error: j.error, size: j.size };
}
