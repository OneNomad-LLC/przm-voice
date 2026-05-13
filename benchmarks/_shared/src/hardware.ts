/**
 * Hardware probe — captures the rig the bench is running on so every
 * receipt is self-describing. Direct port of Pyre's `_shared/hardware.ts`.
 * Graceful failure: every probe returns null on error, the bench keeps
 * running with whatever info was gathered.
 */

import { cpus, freemem, platform, release, totalmem } from 'node:os';
import { execFile } from 'node:child_process';

export interface HardwareInfo {
  os: string;
  cpu: string;
  cpuCores: number;
  systemRamGb: number;
  systemRamFreeGb: number;
  gpu: string | null;
  vramGb: number | null;
  source: 'nvidia-smi' | 'wmic' | 'lspci' | 'system_profiler' | 'cli-flag' | 'none';
}

const PROBE_TIMEOUT_MS = 3000;

function execTimeout(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
    child.on('error', reject);
  });
}

async function probeNvidiaSmi(): Promise<{ gpu: string; vramGb: number } | null> {
  try {
    const out = await execTimeout('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
    const line = out.trim().split(/\r?\n/)[0]?.split(',').map(s => s.trim());
    if (!line || line.length < 2) return null;
    const name = line[0];
    const mb = parseInt(line[1] ?? '', 10);
    if (!name || !Number.isFinite(mb) || mb <= 0) return null;
    return { gpu: name, vramGb: Math.round(mb / 1024 * 10) / 10 };
  } catch { return null; }
}

async function probeWindowsWmic(): Promise<{ gpu: string; vramGb: number } | null> {
  try {
    const out = await execTimeout('wmic', ['path', 'win32_VideoController', 'get', 'name,AdapterRAM', '/format:csv']);
    const lines = out.trim().split(/\r?\n/).filter(l => l.includes(','));
    const rows = lines.slice(1);
    let best: { name: string; bytes: number } | null = null;
    for (const row of rows) {
      const cols = row.split(',').map(c => c.trim());
      if (cols.length < 3) continue;
      const ram = parseInt(cols[1] ?? '', 10);
      const name = cols[2];
      if (!name || !Number.isFinite(ram)) continue;
      if (!best || ram > best.bytes) best = { name, bytes: ram };
    }
    if (!best) return null;
    return { gpu: best.name, vramGb: Math.round(best.bytes / 1024 / 1024 / 1024 * 10) / 10 };
  } catch { return null; }
}

async function probeLinuxLspci(): Promise<{ gpu: string; vramGb: number } | null> {
  try {
    const out = await execTimeout('sh', ['-c', "lspci | grep -iE 'vga|3d|display' | head -1"]);
    const line = out.trim();
    if (!line) return null;
    const colon = line.indexOf(':');
    const name = colon >= 0 ? line.slice(colon + 1).trim() : line;
    return { gpu: name, vramGb: 0 };
  } catch { return null; }
}

async function probeMacosSystemProfiler(): Promise<{ gpu: string; vramGb: number } | null> {
  try {
    const out = await execTimeout('system_profiler', ['SPDisplaysDataType']);
    const text = out;
    const nameMatch = /Chipset Model:\s*(.+)/.exec(text);
    const vramMatch = /(VRAM \(Total\)|Memory):\s*([0-9.]+)\s*(MB|GB)/i.exec(text);
    const name = nameMatch?.[1]?.trim();
    if (!name) return null;
    let vramGb = 0;
    if (vramMatch) {
      const n = parseFloat(vramMatch[2] ?? '0');
      vramGb = vramMatch[3]?.toUpperCase() === 'GB' ? n : Math.round(n / 1024 * 10) / 10;
    }
    return { gpu: name, vramGb };
  } catch { return null; }
}

export async function probeHardware(overrides?: { gpu?: string; vramGb?: number }): Promise<HardwareInfo> {
  const cpuList = cpus();
  const base = {
    os: `${platform()} ${release()}`,
    cpu: cpuList[0]?.model ?? 'unknown',
    cpuCores: cpuList.length,
    systemRamGb: Math.round(totalmem() / 1024 / 1024 / 1024 * 10) / 10,
    systemRamFreeGb: Math.round(freemem() / 1024 / 1024 / 1024 * 10) / 10,
  };

  if (overrides?.gpu) {
    return { ...base, gpu: overrides.gpu, vramGb: overrides.vramGb ?? null, source: 'cli-flag' };
  }

  const plat = platform();
  const nvidia = await probeNvidiaSmi();
  if (nvidia) return { ...base, gpu: nvidia.gpu, vramGb: nvidia.vramGb, source: 'nvidia-smi' };

  if (plat === 'win32') {
    const wmic = await probeWindowsWmic();
    if (wmic) {
      const vram = wmic.vramGb >= 0.5 && wmic.vramGb < 4.5 ? wmic.vramGb : (overrides?.vramGb ?? null);
      return { ...base, gpu: wmic.gpu, vramGb: vram, source: 'wmic' };
    }
  } else if (plat === 'linux') {
    const lspci = await probeLinuxLspci();
    if (lspci) return { ...base, gpu: lspci.gpu, vramGb: overrides?.vramGb ?? null, source: 'lspci' };
  } else if (plat === 'darwin') {
    const mac = await probeMacosSystemProfiler();
    if (mac) return { ...base, gpu: mac.gpu, vramGb: mac.vramGb || (overrides?.vramGb ?? null), source: 'system_profiler' };
  }

  return { ...base, gpu: null, vramGb: overrides?.vramGb ?? null, source: 'none' };
}
