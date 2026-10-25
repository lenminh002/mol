"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { CameraControls, Stars } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { useSim } from "@/lib/store";
import type { CellLocation, Target } from "@/lib/types";
import { DrugParticles } from "./DrugParticles";
import { Hotspot, LabelProjector } from "./Hotspot";
import {
  DRUG_ENTRY,
  MEMBRANE_RADIUS,
  ORGANELLES,
  organelleAnims,
} from "./layout";
import {
  EndoplasmicReticulum,
  Membrane,
  Mitochondria,
  Nucleus,
  Ribosomes,
} from "./Organelles";
import { ReasoningPath } from "./ReasoningPath";

const HOME_CAMERA: [number, number, number, number, number, number] = [
  7, 3.5, 7.5, 0, 0, 0,
];

// Membrane targets sit on the surface; everything else sits at its organelle.
function hotspotPosition(t: Target, index: number): THREE.Vector3 {
  const base = ORGANELLES[t.cell_location].position.clone();
  if (t.cell_location === "membrane") {
    const dir = base
      .normalize()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), index * 0.5);
    return dir.multiplyScalar(MEMBRANE_RADIUS);
  }
  return base.add(new THREE.Vector3(0.35 * index, 0.55, 0.35));
}

export function CellScene() {
  const { result, highlight, view, selectTarget } = useSim();
  const controls = useRef<CameraControls>(null);
  const labelRefs = useRef<(HTMLElement | null)[]>([]);

  const anims = useMemo(() => organelleAnims(result?.effects ?? []), [result]);
  const targets = useMemo(
    () =>
      (result?.targets ?? []).map((t, i) => ({
        target: t,
        position: hotspotPosition(t, i),
      })),
    [result],
  );

  const pathPoints = useMemo(() => {
    if (!result || targets.length === 0) return [];
    const seen = new Set<CellLocation>([targets[0].target.cell_location]);
    const pts = [DRUG_ENTRY.clone().multiplyScalar(0.75), targets[0].position];
    for (const e of result.effects) {
      if (seen.has(e.organelle)) continue;
      seen.add(e.organelle);
      pts.push(ORGANELLES[e.organelle].position);
    }
    return pts;
  }, [result, targets]);

  useEffect(() => {
    if (view === "cell") controls.current?.setLookAt(...HOME_CAMERA, true);
  }, [result, view]);

  function flyTo(name: string, pos: THREE.Vector3) {
    // Stop short of the particle cloud, then hand off to the molecule view.
    const eye = pos
      .clone()
      .normalize()
      .multiplyScalar(pos.length() + 3.5);
    controls.current?.setLookAt(eye.x, eye.y + 0.6, eye.z, pos.x, pos.y, pos.z, true);
    setTimeout(() => selectTarget(name), 900);
  }

  const primaryBlocked = targets[0]
    ? anims[targets[0].target.cell_location].blocked
    : false;

  return (
    <div className="absolute inset-0">
      <Canvas
        camera={{
          position: HOME_CAMERA.slice(0, 3) as [number, number, number],
          fov: 45,
        }}
        dpr={[1, 2]}
      >
        <color attach="background" args={["#070b14"]} />
        <ambientLight intensity={0.35} />
        <pointLight position={[6, 6, 6]} intensity={60} color="#c7d2fe" />
        <pointLight position={[-6, -3, -4]} intensity={25} color="#5eead4" />
        <Stars
          radius={40}
          depth={20}
          count={1200}
          factor={2}
          fade
          speed={0.4}
        />

        <group>
          <Membrane anims={anims} highlight={highlight} />
          <Nucleus anims={anims} highlight={highlight} />
          <Mitochondria anims={anims} highlight={highlight} />
          <EndoplasmicReticulum anims={anims} highlight={highlight} />
          <Ribosomes anims={anims} highlight={highlight} />
        </group>

        {targets.map(({ target, position }) => (
          <Hotspot
            key={target.name}
            position={position}
            blocked={anims[target.cell_location].blocked}
            onSelect={() => flyTo(target.name, position)}
          />
        ))}
        <LabelProjector
          anchors={targets.map((t) => t.position)}
          labels={labelRefs}
        />
        {targets[0] && (
          <DrugParticles
            target={targets[0].position}
            blocked={primaryBlocked}
          />
        )}
        <ReasoningPath points={pathPoints} />

        <CameraControls
          ref={controls}
          minDistance={2.5}
          maxDistance={18}
          smoothTime={0.6}
        />
        <EffectComposer>
          <Bloom
            intensity={0.9}
            luminanceThreshold={0.25}
            luminanceSmoothing={0.6}
            mipmapBlur
          />
          <Vignette offset={0.3} darkness={0.6} />
        </EffectComposer>
      </Canvas>
      {targets.map(({ target, position }, i) => (
        <button
          key={target.name}
          ref={(el) => {
            labelRefs.current[i] = el;
          }}
          onClick={() => flyTo(target.name, position)}
          className="absolute left-0 top-0 whitespace-nowrap rounded-md border border-border bg-card/90 px-2 py-1 text-xs text-foreground backdrop-blur transition-opacity hover:border-brand"
        >
          {target.name}
          {target.pdb_id && (
            <span className="ml-1 text-muted-foreground">{target.pdb_id}</span>
          )}
        </button>
      ))}
    </div>
  );
}
