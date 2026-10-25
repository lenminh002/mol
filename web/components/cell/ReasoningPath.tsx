"use client";

import { useMemo, useRef } from "react";
import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface Props {
  points: THREE.Vector3[]; // drug entry → target → affected organelles
}

// The judge's reasoning chain drawn as a glowing curve that "travels" hop by hop.
export function ReasoningPath({ points }: Props) {
  const lineRef = useRef<{ material: { dashOffset: number } } | null>(null);
  const curvePoints = useMemo(() => {
    if (points.length < 2) return [];
    // Bow each hop outward a little so the path reads as arcs, not straight cuts.
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const mid = a.clone().lerp(b, 0.5);
      mid.add(mid.clone().normalize().multiplyScalar(0.5));
      pts.push(...new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(24).slice(i === 0 ? 0 : 1));
    }
    return pts;
  }, [points]);

  useFrame((_, dt) => {
    if (lineRef.current) lineRef.current.material.dashOffset -= dt * 0.8;
  });

  if (curvePoints.length === 0) return null;
  return (
    <group>
      <Line points={curvePoints} color="#fde047" lineWidth={1} transparent opacity={0.25} />
      <Line
        ref={lineRef as never}
        points={curvePoints}
        color="#fef08a"
        lineWidth={3}
        dashed
        dashSize={0.35}
        gapSize={0.5}
        toneMapped={false}
      />
      {points.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.06, 12, 12]} />
          <meshBasicMaterial color="#fef08a" toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}
