"use client";

import { useSyncExternalStore } from "react";

// One shared clock for the effect timeline. The 3D scene reads `playback` directly every frame
// (no React re-renders); DOM controls subscribe to a throttled snapshot instead.
export const playback = { t: 0, playing: false, speed: 1, duration: 20 };

export interface PlaybackSnapshot {
  t: number;
  playing: boolean;
  speed: number;
  duration: number;
}

const NOTIFY_MS = 66;
let snapshot: PlaybackSnapshot = { ...playback };
let lastNotify = 0;
const listeners = new Set<() => void>();

function publish() {
  snapshot = { t: playback.t, playing: playback.playing, speed: playback.speed, duration: playback.duration };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function usePlayback(): PlaybackSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

/** Advance the clock; called once per frame by the 3D scene. */
export function stepPlayback(dt: number, nowMs: number) {
  if (!playback.playing) return;
  playback.t = Math.min(playback.duration, playback.t + dt * playback.speed);
  if (playback.t >= playback.duration) {
    playback.playing = false;
    publish();
  } else if (nowMs - lastNotify > NOTIFY_MS) {
    lastNotify = nowMs;
    publish();
  }
}

/** A new result arrived: start from the needle, or jump to the finished state when motion is reduced. */
export function resetPlayback(duration: number, mode: "play" | "end" | "idle") {
  playback.duration = duration;
  playback.t = mode === "end" ? duration : 0;
  playback.playing = mode === "play";
  publish();
}

export function seekPlayback(t: number) {
  playback.t = Math.min(playback.duration, Math.max(0, t));
  publish();
}

export function setPlaying(playing: boolean) {
  if (playing && playback.t >= playback.duration) playback.t = 0;
  playback.playing = playing;
  publish();
}

export function replayPlayback() {
  playback.t = 0;
  playback.playing = true;
  publish();
}

export function setPlaybackSpeed(speed: number) {
  playback.speed = speed;
  publish();
}
