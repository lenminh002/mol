"use client";

import { useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import { playback, stepPlayback } from "./playback";

/** Advances the shared playback clock once per frame, before anything reads it. */
export function PlaybackDriver() {
  useFrame(({ clock }, delta) => stepPlayback(Math.min(delta, 0.1), clock.elapsedTime * 1000), -3);
  return null;
}

/** Shows its children only once the playback clock has passed `from`. */
export function TimeGate({ from, children }: { from: number; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => { if (group.current) group.current.visible = playback.t >= from; });
  return <group ref={group} visible={false}>{children}</group>;
}
