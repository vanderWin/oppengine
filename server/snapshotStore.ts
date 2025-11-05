import { promises as fs } from "fs";
import path from "path";

const SNAPSHOT_MODE = (process.env.SNAPSHOT_MODE ?? "").toLowerCase();
const SNAPSHOT_DIR = path.resolve(process.cwd(), "snapshots");

function isSnapshotEnabled(): boolean {
  if (!SNAPSHOT_MODE) return false;
  return !["off", "false", "none", "0"].includes(SNAPSHOT_MODE);
}

function sanitizeSegment(segment: string): string {
  const cleaned = segment.replace(/[^a-zA-Z0-9-_]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "snapshot";
}

function resolveSnapshotPath(key: string | string[]): string {
  const segments = Array.isArray(key)
    ? key
    : key.split("/").filter(Boolean);
  if (segments.length === 0) {
    segments.push("snapshot");
  }
  const safeSegments = segments.map(sanitizeSegment);
  const fileName = safeSegments.pop()!;
  return path.join(SNAPSHOT_DIR, ...safeSegments, `${fileName}.json`);
}

async function ensureDirExists(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

export async function loadSnapshot<T = unknown>(key: string | string[]): Promise<T | null> {
  if (!isSnapshotEnabled()) {
    return null;
  }

  const filePath = resolveSnapshotPath(key);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      console.warn(`[Snapshot] Failed to read snapshot "${filePath}":`, error);
    }
    return null;
  }
}

export async function saveSnapshot<T = unknown>(key: string | string[], data: T): Promise<void> {
  if (!isSnapshotEnabled()) {
    return;
  }

  const filePath = resolveSnapshotPath(key);
  try {
    await ensureDirExists(filePath);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
    console.log(`[Snapshot] Saved snapshot to ${filePath}`);
  } catch (error) {
    console.warn(`[Snapshot] Failed to write snapshot "${filePath}":`, error);
  }
}

export function getSnapshotInfo(): { enabled: boolean; mode: string; dir: string } {
  return {
    enabled: isSnapshotEnabled(),
    mode: SNAPSHOT_MODE || "off",
    dir: SNAPSHOT_DIR,
  };
}
