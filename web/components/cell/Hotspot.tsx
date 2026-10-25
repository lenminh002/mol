"use client";

import { useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { deformPoint, type SquishState } from "./squish";

interface Props {
  position: THREE.Vector3;
  blocked: boolean;
  onSelect?: () => void;
  targetName?: string;
  squish?: SquishState;
  surface?: boolean;
}

// A binding-site pin. Its owner can route pointer events through targetName.
export function Hotspot({ position, blocked, onSelect, targetName, squish, surface = false }: Props) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const color = blocked ? "#c84b43" : "#0f766e";

  useFrame(({ clock, camera }) => {
    if (group.current) {
      if (squish) deformPoint(position, squish, surface ? 1 : 0.18, surface ? 1 : 1.8, group.current.position);
      else group.current.position.copy(position);
    }
    if (!ring.current) return;
    ring.current.scale.setScalar(1 + 0.08 * Math.sin(clock.elapsedTime * 3));
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
        <sphereGeometry args={[0.09, 20, 20]} />
        <meshStandardMaterial color={color} roughness={0.65} emissive={color} emissiveIntensity={0.12} toneMapped />
      </mesh>
      <mesh ref={ring}>
        <ringGeometry args={[0.14, 0.154, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.65} toneMapped side={THREE.DoubleSide} depthWrite={false} />
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
}: {
  anchors: THREE.Vector3[];
  labels: RefObject<(HTMLElement | null)[]>;
  squish?: SquishState;
  surface?: boolean[];
  offset?: THREE.Vector3;
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
