"use client";

import { useMemo, useRef, type ComponentRef } from "react";
import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { deformPoint, type SquishState } from "./squish";

interface Props {
  points: THREE.Vector3[]; // drug entry → target → affected organelles
  squish?: SquishState;
  surface?: boolean[];
  fixed?: boolean[];
}

type PathLine = ComponentRef<typeof Line>;
const HOP_SEGMENTS = 24;

function arcPoints(anchors: THREE.Vector3[], out: THREE.Vector3[], mid: THREE.Vector3, bow: THREE.Vector3) {
  let index = 0;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    mid.copy(a).lerp(b, 0.5);
    bow.copy(mid).normalize().multiplyScalar(0.5);
    mid.add(bow);
    for (let step = i === 0 ? 0 : 1; step <= HOP_SEGMENTS; step++) {
      const t = step / HOP_SEGMENTS;
      out[index++].copy(a).multiplyScalar((1 - t) ** 2)
        .addScaledVector(mid, 2 * (1 - t) * t).addScaledVector(b, t * t);
    }
  }
}

// Update the existing interleaved GPU buffers as endpoints follow the cell.
function updateLine(line: PathLine | null, points: THREE.Vector3[]) {
  if (!line) return;
  const starts = line.geometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute | undefined;
  const ends = line.geometry.getAttribute("instanceEnd") as THREE.InterleavedBufferAttribute | undefined;
  if (!starts || !ends || starts.count !== points.length - 1) return;
  const distanceStarts = line.geometry.getAttribute("instanceDistanceStart") as THREE.InterleavedBufferAttribute | undefined;
  const distanceEnds = line.geometry.getAttribute("instanceDistanceEnd") as THREE.InterleavedBufferAttribute | undefined;
  let distance = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    starts.setXYZ(i, a.x, a.y, a.z);
    ends.setXYZ(i, b.x, b.y, b.z);
    distanceStarts?.setX(i, distance);
    distance += a.distanceTo(b);
    distanceEnds?.setX(i, distance);
  }
  starts.data.needsUpdate = true;
  if (distanceStarts) distanceStarts.data.needsUpdate = true;
}

// The judge's reasoning chain travels hop by hop between its moving anchors.
export function ReasoningPath({ points, squish, surface, fixed }: Props) {
  const underlayRef = useRef<PathLine>(null);
  const lineRef = useRef<PathLine>(null);
  const nodeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const path = useMemo(() => {
    const anchors = points.map((point) => point.clone());
    const curves = Array.from({ length: points.length < 2 ? 0 : 1 + HOP_SEGMENTS * (points.length - 1) }, () => new THREE.Vector3());
    const mid = new THREE.Vector3();
    const bow = new THREE.Vector3();
    arcPoints(anchors, curves, mid, bow);
    return { anchors, curves, mid, bow };
  }, [points]);

  useFrame((_, dt) => {
    if (path.curves.length === 0) return;
    points.forEach((point, i) => {
      const staysFixed = fixed?.[i] ?? i === 0;
      const onSurface = surface?.[i] ?? false;
      if (squish && !staysFixed) deformPoint(point, squish, onSurface ? 1 : 0.18, onSurface ? 1 : 1.8, path.anchors[i]);
      else path.anchors[i].copy(point);
      nodeRefs.current[i]?.position.copy(path.anchors[i]);
    });
    arcPoints(path.anchors, path.curves, path.mid, path.bow);
    updateLine(underlayRef.current, path.curves);
    updateLine(lineRef.current, path.curves);
    if (lineRef.current) lineRef.current.material.dashOffset -= dt * 0.8;
  });

  if (path.curves.length === 0) return null;
  return (
    <group>
      <Line ref={underlayRef} points={path.curves} color="#d97706" lineWidth={1} transparent opacity={0.25} toneMapped frustumCulled={false} raycast={() => {}} />
      <Line
        ref={lineRef}
        points={path.curves}
        color="#d97706"
        lineWidth={2}
        dashed
        dashSize={0.35}
        gapSize={0.5}
        toneMapped
        frustumCulled={false}
        raycast={() => {}}
      />
      {points.map((p, i) => (
        <mesh key={i} ref={(mesh) => { nodeRefs.current[i] = mesh; }} position={p} raycast={() => {}}>
          <sphereGeometry args={[0.06, 12, 12]} />
          <meshBasicMaterial color="#d97706" toneMapped />
        </mesh>
      ))}
    </group>
  );
}
