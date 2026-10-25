"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DRUG_ENTRY } from "./layout";

const COUNT = 90;

interface Props {
  target: THREE.Vector3;
  blocked: boolean; // particles pile up at the target instead of flowing through
  color?: string;
}

// Drug molecules streaming from outside the cell toward the target hotspot.
export function DrugParticles({ target, blocked, color = "#fde047" }: Props) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const seeds = useMemo(
    () =>
      Array.from({ length: COUNT }, () => ({
        offset: Math.random(),
        speed: 0.12 + Math.random() * 0.12,
        jitter: new THREE.Vector3().randomDirection().multiplyScalar(0.25 + Math.random() * 0.35),
      })),
    [],
  );
  const curve = useMemo(() => {
    const mid = DRUG_ENTRY.clone().lerp(target, 0.5).add(new THREE.Vector3(0, 1.2, 0));
    return new THREE.QuadraticBezierCurve3(DRUG_ENTRY, mid, target);
  }, [target]);

  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = clock.elapsedTime;
    seeds.forEach((s, i) => {
      let u = (s.offset + t * s.speed) % 1;
      // When blocked, particles stall in a cloud just outside the binding site.
      if (blocked) u = Math.min(u * 1.4, 0.93);
      const p = curve.getPoint(u);
      const spread = Math.sin(u * Math.PI);
      dummy.position.copy(p).addScaledVector(s.jitter, spread + (blocked && u > 0.9 ? 0.4 : 0));
      dummy.scale.setScalar(u > 0.97 ? 0.4 : 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, COUNT]}>
      <icosahedronGeometry args={[0.045, 1]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2} toneMapped={false} />
    </instancedMesh>
  );
}
