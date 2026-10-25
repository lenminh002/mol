"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { CellLocation } from "@/lib/types";
import { MEMBRANE_RADIUS, MITO_POSITIONS, ORGANELLES, animFactor, type OrganelleAnim } from "./layout";

interface Props {
  anims: Record<CellLocation, OrganelleAnim>;
  highlight: string | null;
}

interface MatOpts {
  color: string;
  opacity: number;
  emissive: number; // resting emissive intensity
}

// One emissive material per organelle, driven every frame by its effect animation.
function useOrganelleMaterial(loc: CellLocation, { anims, highlight }: Props, opts: MatOpts) {
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: opts.color,
        emissive: ORGANELLES[loc].color,
        emissiveIntensity: opts.emissive,
        transparent: true,
        opacity: opts.opacity,
        roughness: 0.45,
        depthWrite: opts.opacity > 0.5,
        side: opts.opacity < 0.5 ? THREE.DoubleSide : THREE.FrontSide,
      }),
    [loc, opts.color, opts.opacity, opts.emissive],
  );
  const baseColor = useMemo(() => new THREE.Color(ORGANELLES[loc].color), [loc]);

  useFrame(({ clock }) => {
    const a = anims[loc];
    const target = a.tint ? baseColor.clone().lerp(new THREE.Color(a.tint), 0.65) : baseColor;
    material.emissive.lerp(target, 0.08);
    material.emissiveIntensity = opts.emissive * animFactor(a, clock.elapsedTime, highlight === loc);
    // Speculative effects render as a faded wireframe "sketch" of the organelle.
    material.wireframe = a.dashed;
    const targetOpacity = a.dashed ? opts.opacity * 0.6 : a.intensity < 1 ? opts.opacity * 0.45 : opts.opacity;
    material.opacity = THREE.MathUtils.lerp(material.opacity, targetOpacity, 0.08);
  });
  return material;
}

export function Membrane(props: Props) {
  const material = useOrganelleMaterial("membrane", props, { color: "#0f766e", opacity: 0.12, emissive: 0.25 });
  return (
    <group>
      <mesh material={material}>
        <sphereGeometry args={[MEMBRANE_RADIUS, 96, 96]} />
      </mesh>
      <mesh>
        <sphereGeometry args={[MEMBRANE_RADIUS * 1.003, 40, 40]} />
        <meshBasicMaterial color="#5eead4" wireframe transparent opacity={0.05} />
      </mesh>
    </group>
  );
}

export function Nucleus(props: Props) {
  const material = useOrganelleMaterial("nucleus", props, { color: "#4c1d95", opacity: 0.85, emissive: 0.5 });
  return (
    <group position={ORGANELLES.nucleus.position}>
      <mesh material={material}>
        <sphereGeometry args={[1.0, 64, 64]} />
      </mesh>
      {/* nucleolus */}
      <mesh position={[0.25, 0.2, 0.3]}>
        <sphereGeometry args={[0.32, 32, 32]} />
        <meshStandardMaterial color="#c4b5fd" emissive="#c4b5fd" emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

export function Mitochondria(props: Props) {
  const material = useOrganelleMaterial("mitochondria", props, { color: "#9a3412", opacity: 0.95, emissive: 0.6 });
  return (
    <group>
      {MITO_POSITIONS.map(([pos, rot], i) => (
        <mesh key={i} position={pos} rotation={rot} material={material}>
          <capsuleGeometry args={[0.22, 0.6, 8, 16]} />
        </mesh>
      ))}
    </group>
  );
}

export function EndoplasmicReticulum(props: Props) {
  const material = useOrganelleMaterial("er", props, { color: "#831843", opacity: 0.9, emissive: 0.5 });
  const geometry = useMemo(() => {
    // Folded ribbon wrapping part of the nucleus.
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 80; i++) {
      const t = i / 80;
      const a = Math.PI * 0.1 + t * Math.PI * 1.1;
      const r = 1.35 + 0.18 * Math.sin(t * Math.PI * 9);
      pts.push(new THREE.Vector3(Math.cos(a) * r, -0.6 + 0.35 * Math.sin(t * Math.PI * 5), Math.sin(a) * r * 0.8));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 200, 0.07, 8, false);
  }, []);
  const { x, z } = ORGANELLES.nucleus.position;
  return <mesh geometry={geometry} material={material} position={[x, 0, z]} />;
}

const RIBOSOME_COUNT = 260;

export function Ribosomes(props: Props) {
  const material = useOrganelleMaterial("cytoplasm", props, { color: "#64748b", opacity: 1, emissive: 0.7 });
  const matrices = useMemo(() => {
    const o = new THREE.Object3D();
    const out: THREE.Matrix4[] = [];
    while (out.length < RIBOSOME_COUNT) {
      const p = new THREE.Vector3().randomDirection().multiplyScalar(1.3 + Math.random() * 1.5);
      if (p.distanceTo(ORGANELLES.nucleus.position) < 1.15) continue;
      o.position.copy(p);
      o.scale.setScalar(0.6 + Math.random() * 0.6);
      o.updateMatrix();
      out.push(o.matrix.clone());
    }
    return out;
  }, []);
  return (
    <instancedMesh
      ref={(mesh) => {
        if (!mesh) return;
        matrices.forEach((mx, i) => mesh.setMatrixAt(i, mx));
        mesh.instanceMatrix.needsUpdate = true;
      }}
      args={[undefined, material, RIBOSOME_COUNT]}
    >
      <sphereGeometry args={[0.035, 8, 8]} />
    </instancedMesh>
  );
}
