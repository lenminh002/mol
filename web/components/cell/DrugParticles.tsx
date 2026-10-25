"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PHASE, smoothstep } from "./effectTimeline";
import { INJECTION_POINT } from "./injection";
import { seededRandom } from "./layout";
import { playback } from "./playback";
import { deformPoint, type SquishState } from "./squish";

const COUNT = 90;
const BURST = 0.9; // seconds spent spreading out of the needle before heading for the target

interface Props {
  target: THREE.Vector3;
  blocked: boolean; // particles stay crowded around the target instead of thinning out once it is bound
  color?: string;
  squish?: SquishState;
  surface?: boolean;
}

// Drug molecules released by the needle, travelling to the target and docking there.
// Positions are a pure function of the playback clock, so scrubbing replays them exactly.
export function DrugParticles({ target, blocked, color = "#d97706", squish, surface = false }: Props) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const scratch = useMemo(() => ({ goal: new THREE.Vector3(), start: new THREE.Vector3(), control: new THREE.Vector3(), point: new THREE.Vector3() }), []);
  const seeds = useMemo(() => {
    const random = seededRandom(9157);
    const unit = () => {
      const z = random() * 2 - 1;
      const a = random() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      return new THREE.Vector3(r * Math.cos(a), z, r * Math.sin(a));
    };
    return Array.from({ length: COUNT }, (_, i) => ({
      born: PHASE.injectStart + ((i + random() * 0.8) / COUNT) * (PHASE.injectEnd - 0.3 - PHASE.injectStart),
      burst: unit().multiplyScalar(0.15 + random() * 0.45),
      travel: 1.8 + random() * 0.6,
      jitter: unit().multiplyScalar(0.2 + random() * 0.3),
      axis: unit(),
      phase: random() * Math.PI * 2,
      radius: 0.14 + random() * 0.1,
      spin: 1.2 + random() * 1.6,
    }));
  }, []);

  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = playback.t;
    const { goal, start, control, point } = scratch;
    if (squish) deformPoint(target, squish, surface ? 1 : 0.18, surface ? 1 : 1.8, goal);
    else goal.copy(target);

    seeds.forEach((s, i) => {
      const tau = t - s.born;
      let scale = 0;
      if (tau >= 0) {
        start.copy(INJECTION_POINT).add(s.burst);
        if (tau < BURST) {
          const e = 1 - (1 - tau / BURST) ** 2;
          point.copy(INJECTION_POINT).addScaledVector(s.burst, e);
          scale = 0.3 + 0.7 * e;
        } else if (tau < BURST + s.travel) {
          const u = smoothstep((tau - BURST) / s.travel);
          control.copy(start).lerp(goal, 0.5);
          control.y += 0.6;
          // Quadratic Bezier start -> control -> goal, with a little wandering mid-flight.
          point.copy(start).multiplyScalar((1 - u) ** 2).addScaledVector(control, 2 * (1 - u) * u).addScaledVector(goal, u * u);
          point.addScaledVector(s.jitter, Math.sin(u * Math.PI) * 0.5);
          scale = 1;
        } else {
          // Docked: orbit the target, crowding closer and staying bright when it is blocked.
          const settle = smoothstep((tau - BURST - s.travel) / 0.5);
          const angle = s.phase + clock.elapsedTime * s.spin;
          const r = s.radius * settle * (blocked ? 1 : 1.25);
          point.copy(goal);
          point.x += Math.cos(angle) * r * (1 - Math.abs(s.axis.x) * 0.4);
          point.y += Math.sin(angle) * r * 0.6 * (0.6 + Math.abs(s.axis.y));
          point.z += Math.sin(angle * 0.8 + s.phase) * r * (1 - Math.abs(s.axis.z) * 0.4);
          scale = blocked ? 1 : 1 - 0.55 * smoothstep((t - PHASE.cascadeStart) / 3);
        }
      }
      dummy.position.copy(point);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, COUNT]} frustumCulled={false} raycast={() => {}}>
      <icosahedronGeometry args={[0.045, 1]} />
      <meshStandardMaterial color={color} roughness={0.55} emissive={color} emissiveIntensity={0.3} toneMapped />
    </instancedMesh>
  );
}
