"use client";

import { useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { smoothstep } from "./effectTimeline";
import { playback } from "./playback";
import { deformPoint, type SquishState } from "./squish";

interface Props {
  position: THREE.Vector3;
  tint?: string | null; // colour of the effect on the target's organelle; teal when it has none
  onSelect?: () => void;
  targetName?: string;
  squish?: SquishState;
  surface?: boolean;
  offTarget?: boolean; // weaker binding partner: smaller, neutral, no binding flash
  flashAt?: number; // playback time of the binding flash; the pin wakes up shortly before it
}

// A binding-site pin. Its owner can route pointer events through targetName.
export function Hotspot({ position, tint, onSelect, targetName, squish, surface = false, offTarget = false, flashAt }: Props) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.MeshStandardMaterial>(null);
  const halo = useRef<THREE.MeshBasicMaterial>(null);
  const color = offTarget ? "#7c8a86" : tint ?? "#0f766e";

  useFrame(({ clock, camera }) => {
    if (group.current) {
      if (squish) deformPoint(position, squish, surface ? 1 : 0.18, surface ? 1 : 1.8, group.current.position);
      else group.current.position.copy(position);
    }
    if (!ring.current) return;
    // Before the flash the pin is a quiet marker; the drug docking makes it flare, then it settles.
    const flash = flashAt === undefined || offTarget ? 0 : Math.exp(-(((playback.t - flashAt) / 0.45) ** 2));
    const awake = flashAt === undefined || offTarget ? 1 : 0.35 + 0.65 * smoothstep((playback.t - (flashAt - 1.5)) / 1.5);
    ring.current.scale.setScalar(1 + 0.08 * Math.sin(clock.elapsedTime * 3) + flash * 1.6);
    if (core.current) core.current.emissiveIntensity = 0.12 + flash * 1.1;
    if (halo.current) halo.current.opacity = 0.65 * awake * (1 - 0.5 * flash);
    ring.current.lookAt(camera.position);
  });

  return (
    <group ref={group} position={position} userData={{ targetName, hotspot: true }}>
      <mesh
        onClick={targetName || !onSelect ? undefined : (e) => {
          if (e.delta >= 4) return;
          e.stopPropagation();
          onSelect();
        }}
      >
        <sphereGeometry args={[offTarget ? 0.06 : 0.09, 20, 20]} />
        <meshStandardMaterial ref={core} color={color} roughness={0.65} emissive={color} emissiveIntensity={0.12} toneMapped />
      </mesh>
      <mesh ref={ring}>
        <ringGeometry args={[0.14, 0.154, 48]} />
        <meshBasicMaterial ref={halo} color={color} transparent opacity={0.65} toneMapped side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

// Moves DOM labels (rendered outside the Canvas) to follow 3D points every frame.
// Used instead of drei <Html>, whose portal roots fail to mount under React 19 here.
export function LabelProjector({
  anchors,
  labels,
  squish,
  surface,
  offset,
  showAt,
}: {
  anchors: THREE.Vector3[];
  labels: RefObject<(HTMLElement | null)[]>;
  squish?: SquishState;
  surface?: boolean[];
  offset?: THREE.Vector3;
  showAt?: number[]; // playback time at which each label appears
}) {
  const { size } = useThree();
  const v = useRef(new THREE.Vector3());
  const anchor = useRef(new THREE.Vector3());
  const normal = useRef(new THREE.Vector3());
  const towardCamera = useRef(new THREE.Vector3());
  useFrame(({ camera }) => {
    anchors.forEach((a, i) => {
      const el = labels.current?.[i];
      if (!el) return;
      if (showAt && playback.t < (showAt[i] ?? 0)) {
        el.style.visibility = "hidden";
        el.style.pointerEvents = "none";
        el.style.opacity = "0";
        return;
      }
      const onSurface = surface?.[i] ?? false;
      if (squish) deformPoint(a, squish, onSurface ? 1 : 0.18, onSurface ? 1 : 1.8, anchor.current);
      else anchor.current.copy(a);
      v.current.copy(anchor.current);
      if (offset) v.current.add(offset);
      else v.current.y += 0.25;
      v.current.project(camera);
      const visible = v.current.z >= -1 && v.current.z <= 1 &&
        Math.abs(v.current.x) <= 1 && Math.abs(v.current.y) <= 1;
      el.style.visibility = visible ? "visible" : "hidden";
      el.style.pointerEvents = visible ? "auto" : "none";
      if (!visible) {
        el.style.opacity = "0";
        return;
      }
      const x = ((v.current.x + 1) / 2) * size.width;
      const y = ((1 - v.current.y) / 2) * size.height;
      el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
      // Approximate the normal of the flattened membrane, rather than its radius.
      normal.current.set(a.x, a.y / 0.36, a.z).normalize();
      towardCamera.current.subVectors(camera.position, anchor.current).normalize();
      const facingAway = onSurface && normal.current.dot(towardCamera.current) < 0;
      el.style.opacity = facingAway ? "0.28" : "1";
    });
  });
  return null;
}
