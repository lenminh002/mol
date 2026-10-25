"use client";

import { useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

interface Props {
  position: THREE.Vector3;
  blocked: boolean;
  onSelect: () => void;
}

// Glowing, clickable binding site for a drug target.
export function Hotspot({ position, blocked, onSelect }: Props) {
  const ring = useRef<THREE.Mesh>(null);
  const color = blocked ? "#f87171" : "#5eead4";

  useFrame(({ clock, camera }) => {
    if (!ring.current) return;
    ring.current.scale.setScalar(1 + 0.25 * Math.sin(clock.elapsedTime * 4));
    ring.current.lookAt(camera.position);
  });

  return (
    <group position={position}>
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "")}
      >
        <sphereGeometry args={[0.16, 24, 24]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={3} toneMapped={false} />
      </mesh>
      <mesh ref={ring}>
        <ringGeometry args={[0.24, 0.28, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// Moves DOM labels (rendered outside the Canvas) to follow 3D points every frame.
// Used instead of drei <Html>, whose portal roots fail to mount under React 19 here.
export function LabelProjector({
  anchors,
  labels,
}: {
  anchors: THREE.Vector3[];
  labels: RefObject<(HTMLElement | null)[]>;
}) {
  const { size } = useThree();
  const v = useRef(new THREE.Vector3());
  useFrame(({ camera }) => {
    anchors.forEach((a, i) => {
      const el = labels.current?.[i];
      if (!el) return;
      v.current.copy(a).add(new THREE.Vector3(0, 0.4, 0)).project(camera);
      const x = ((v.current.x + 1) / 2) * size.width;
      const y = ((1 - v.current.y) / 2) * size.height;
      el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
      el.style.opacity = v.current.z < 1 ? "1" : "0";
    });
  });
  return null;
}
