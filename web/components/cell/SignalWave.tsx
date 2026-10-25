"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { smoothstep } from "./effectTimeline";
import { playback } from "./playback";
import { deformPoint, type SquishState } from "./squish";

const TRAVEL = 1.4; // seconds for the signal to cross from the target to an organelle
const BURST = 0.9; // seconds for the arrival ring to expand and fade
const TRAIL = 6;

export interface WaveSpec {
  to: THREE.Vector3;
  onset: number; // playback time at which the signal arrives and the organelle starts to change
  color: string;
  inPlace: boolean; // the organelle is the target itself: just ripple outward from it
}

interface Props {
  from: THREE.Vector3;
  waves: WaveSpec[];
  squish?: SquishState;
}

// A glowing signal that leaves the bound target for each affected organelle, then bursts
// into a ring where it lands, just as that organelle begins to change.
export function SignalWaves({ from, waves, squish }: Props) {
  return <>{waves.map((wave, i) => <Pulse key={i} from={from} wave={wave} squish={squish} />)}</>;
}

function Pulse({ from, wave, squish }: { from: THREE.Vector3; wave: WaveSpec; squish?: SquishState }) {
  const head = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const spheres = useRef<(THREE.Mesh | null)[]>([]);
  const color = useMemo(() => new THREE.Color(wave.color), [wave.color]);
  const scratch = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), p: new THREE.Vector3() }), []);

  useFrame(({ camera }) => {
    const t = playback.t;
    const { a, b, c, p } = scratch;
    const tau = t - wave.onset;
    const flight = wave.inPlace ? 0 : (t - (wave.onset - TRAVEL)) / TRAVEL;

    const flying = !wave.inPlace && flight > 0 && flight < 1;
    if (head.current) head.current.visible = flying;
    if (flying) {
      deformPoint(from, squish ?? NO_SQUISH, 0.18, 1.8, a);
      deformPoint(wave.to, squish ?? NO_SQUISH, 0.18, 1.8, b);
      c.copy(a).lerp(b, 0.5);
      c.y += 0.6;
      for (let i = 0; i <= TRAIL; i++) {
        const mesh = spheres.current[i];
        if (!mesh) continue;
        const u = smoothstep(flight - i * 0.045);
        const visible = flight - i * 0.045 > 0;
        mesh.visible = visible;
        if (!visible) continue;
        p.copy(a).multiplyScalar((1 - u) ** 2).addScaledVector(c, 2 * (1 - u) * u).addScaledVector(b, u * u);
        mesh.position.copy(p);
        mesh.scale.setScalar(i === 0 ? 1 : Math.max(0.15, 0.8 - i * 0.11));
      }
    }

    const mesh = ring.current;
    if (!mesh) return;
    const ringT = wave.inPlace ? tau + 0.3 : tau;
    const active = ringT > 0 && ringT < BURST;
    mesh.visible = active;
    if (!active) return;
    const u = ringT / BURST;
    deformPoint(wave.inPlace ? from : wave.to, squish ?? NO_SQUISH, 0.18, 1.8, mesh.position);
    mesh.scale.setScalar(0.1 + 0.7 * (1 - (1 - u) ** 3));
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - u);
    mesh.lookAt(camera.position);
  });

  return (
    <>
      <group ref={head} visible={false}>
        {Array.from({ length: TRAIL + 1 }, (_, i) => (
          <mesh key={i} ref={(el) => { spheres.current[i] = el; }} raycast={() => {}}>
            <sphereGeometry args={[0.055, 14, 14]} />
            <meshBasicMaterial color={color} transparent opacity={i === 0 ? 0.95 : 0.55} toneMapped={false} depthWrite={false} />
          </mesh>
        ))}
      </group>
      <mesh ref={ring} visible={false} raycast={() => {}} renderOrder={8}>
        <ringGeometry args={[0.86, 1, 56]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} side={THREE.DoubleSide} depthWrite={false} depthTest={false} toneMapped={false} />
      </mesh>
    </>
  );
}

// deformPoint needs a state; an inert one leaves points where they are.
const NO_SQUISH: SquishState = {
  grab: new THREE.Vector3(),
  offset: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  dragging: false,
  uniforms: { uGrab: { value: new THREE.Vector3() }, uOffset: { value: new THREE.Vector3() }, uFalloff: { value: 1 } },
};
