/*
 * This file is part of the Nexsland GNOME extension.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * GI-free parsers for /proc/stat, /proc/meminfo and /proc/net/dev, plus the
 * rate maths between two samples.
 */

/** Aggregate CPU jiffies from /proc/stat's first line. */
export function parseProcStat(text) {
  const line = text.split("\n").find((l) => l.startsWith("cpu "));
  if (!line) return null;
  const v = line.trim().split(/\s+/).slice(1).map(Number);
  // user nice system idle iowait irq softirq steal (guest columns are already in user/nice)
  const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = v;
  const idleAll = idle + iowait;
  return { total: user + nice + system + idleAll + irq + softirq + steal, idle: idleAll };
}

/** Busy percentage between two /proc/stat samples (0 when no time has passed). */
export function cpuPercent(prev, next) {
  if (!prev || !next) return 0;
  const total = next.total - prev.total;
  const idle = next.idle - prev.idle;
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, ((total - idle) / total) * 100));
}

/** Used memory as the kernel's own MemTotal - MemAvailable. */
export function parseMeminfo(text) {
  const kb = (key) => {
    const m = text.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"));
    return m ? Number(m[1]) : null;
  };
  const total = kb("MemTotal");
  const available = kb("MemAvailable");
  if (!total || available === null) return null;
  const usedBytes = (total - available) * 1024;
  return { usedBytes, totalBytes: total * 1024, percent: ((total - available) / total) * 100 };
}

/** Summed rx/tx bytes over all interfaces except loopback. */
export function parseNetDev(text) {
  let rx = 0;
  let tx = 0;
  for (const line of text.split("\n").slice(2)) {
    const [name, rest] = line.split(":");
    if (!rest || name.trim() === "lo") continue;
    const cols = rest.trim().split(/\s+/).map(Number);
    rx += cols[0] || 0;
    tx += cols[8] || 0;
  }
  return { rx, tx };
}

/** Bytes per second between two net samples taken `seconds` apart. */
export function netRates(prev, next, seconds) {
  if (!prev || !next || !(seconds > 0)) return { rx: 0, tx: 0 };
  return {
    rx: Math.max(0, (next.rx - prev.rx) / seconds),
    tx: Math.max(0, (next.tx - prev.tx) / seconds),
  };
}

/** 0 -> "0 B", 1536 -> "1.5 KB", 5242880 -> "5.0 MB". */
export function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = Math.max(0, bytes);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return i === 0 ? `${Math.round(v)} B` : `${v.toFixed(1)} ${units[i]}`;
}
