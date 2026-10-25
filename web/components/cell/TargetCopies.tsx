"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { CellLocation } from "@/lib/types";
import { PHASE, smoothstep } from "./effectTimeline";
import { MITOCHONDRIA, NUCLEUS_RADIUS, ORGANELLES, insideCell, membraneRadiusAt, seededRandom } from "./layout";
import { playback } from "./playback";
import { deformPoint, type SquishState } from "./squish";

const COUNT = 14;
const RADIUS = 0.05;

// Scatter copies of the target through the organelle it lives in, so one pin doesn't read as one molecule.
function scatter(location: CellLocation): THREE.Vector3[] {
  const random = seededRandom(4021 + location.length * 131);
  const points: THREE.Vector3[] = [];
  const center = ORGANELLES[location].position;
  if (location === "mitochondria") {
    const step = Math.floor(MITOCHONDRIA.length / COUNT);
    return Array.from({ length: COUNT }, (_, i) => MITOCHONDRIA[1 + i * step].position.clone());
  }
  for (let attempt = 0; points.length < COUNT && attempt < 4000; attempt++) {
    const dir = new THREE.Vector3(random() * 2 - 1, (random() * 2 - 1) * 0.6, random() * 2 - 1);
    if (dir.lengthSq() < 0.01) continue;
    dir.normalize();
    if (location === "membrane") {
      points.push(dir.multiplyScalar(membraneRadiusAt(dir) * 0.995));
      continue;
    }
    const reach = location === "nucleus" ? NUCLEUS_RADIUS * 0.8 : location === "er" ? 0.95 : 1.3;
    const point = center.clone().addScaledVector(dir, reach * Math.cbrt(random()));
    if (!insideCell(point, 0.2)) continue;
    if (location !== "nucleus" && point.distanceTo(ORGANELLES.nucleus.position) < NUCLEUS_RADIUS + 0.12) continue;
    points.push(point);
  }
  return points;
}

// Small dots, one colour with the target pin, appearing after the drug docks. Not pickable.
export function TargetCopies({ location, color, squish }: { location: CellLocation; color: string; squish?: SquishState }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const out = useMemo(() => new THREE.Vector3(), []);
  const points = useMemo(() => scatter(location), [location]);
  const surface = location === "membrane";

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    points.forEach((p, i) => {
      const born = PHASE.bind + 0.2 + i * 0.1;
      const scale = smoothstep((playback.t - born) / 0.5);
      if (squish) deformPoint(p, squish, surface ? 1 : 0.18, surface ? 1 : 1.8, out);
      else out.copy(p);
      dummy.position.copy(out);
      dummy.scale.setScalar(Math.max(scale, 0.0001));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, points.length]} frustumCulled={false} raycast={() => {}}>
      <sphereGeometry args={[RADIUS, 12, 12]} />
      <meshBasicMaterial color={color} toneMapped />
    </instancedMesh>
  );
}
