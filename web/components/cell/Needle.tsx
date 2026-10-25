"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PHASE } from "./effectTimeline";
import { DENT_END, NEEDLE_CONTACT, NEEDLE_DIR, membraneDent, needleHeight, needleOpacity, plungeAmount } from "./injection";
import { playback } from "./playback";
import type { SquishState } from "./squish";

const SCALE = 0.8;
const BARREL_START = 0.84; // local y where the barrel begins (tip is the origin, body extends +y)
const BARREL_LENGTH = 1.2;
const UP = new THREE.Vector3(0, 1, 0);

// A stylised syringe that presses into the membrane, pierces it, empties, and withdraws.
// Everything is a pure function of the playback clock; the dent is written into the shared
// squish state so the membrane, pins and labels all follow it.
export function Needle({ squish }: { squish: SquishState }) {
  const root = useRef<THREE.Group>(null);
  const liquid = useRef<THREE.Mesh>(null);
  const plunger = useRef<THREE.Group>(null);
  const driving = useRef(false);
  const materials = useMemo(() => {
    const make = (color: string, opacity: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
      ({ base: opacity, material: new THREE.MeshStandardMaterial({ color, roughness: 0.4, transparent: true, opacity, ...extra }) });
    return {
      steel: make("#bdb8ae", 1, { metalness: 0.55, roughness: 0.3 }),
      grip: make("#a89f91", 1, { roughness: 0.6 }),
      barrel: make("#f5efe4", 0.34, { roughness: 0.15, side: THREE.DoubleSide, depthWrite: false }),
      liquid: make("#d97706", 0.85, { emissive: "#d97706", emissiveIntensity: 0.25, depthWrite: false }),
    };
  }, []);

  useEffect(() => {
    const all = Object.values(materials);
    return () => all.forEach(({ material }) => material.dispose());
  }, [materials]);

  const release = () => {
    if (!driving.current) return;
    driving.current = false;
    squish.dragging = false;
    squish.offset.setScalar(0);
    squish.velocity.setScalar(0);
  };
  useEffect(() => release, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Runs before the squish spring (priority -1) so the dent lands in the same frame.
  useFrame(() => {
    const t = playback.t;
    const group = root.current;
    if (!group) return;

    const alpha = needleOpacity(t);
    group.visible = alpha > 0.01;
    group.position.copy(NEEDLE_CONTACT).addScaledVector(NEEDLE_DIR, needleHeight(t));
    group.quaternion.setFromUnitVectors(UP, NEEDLE_DIR);
    Object.values(materials).forEach(({ base, material }) => { material.opacity = base * alpha; });

    const f = plungeAmount(t);
    liquid.current?.scale.setY(Math.max(1e-3, 1 - f));
    if (liquid.current) liquid.current.position.y = BARREL_START + (BARREL_LENGTH * (1 - f)) / 2;
    if (plunger.current) plunger.current.position.y = BARREL_START + BARREL_LENGTH * (1 - f);

    const inWindow = t > PHASE.needleArrive && t < DENT_END;
    if (inWindow && (!squish.dragging || driving.current)) {
      // A pointer drag that took over the grab point wins over the needle.
      if (driving.current && squish.grab.distanceToSquared(NEEDLE_CONTACT) > 1e-6) { driving.current = false; return; }
      driving.current = true;
      squish.dragging = true;
      squish.grab.copy(NEEDLE_CONTACT);
      squish.velocity.setScalar(0);
      squish.offset.copy(NEEDLE_DIR).multiplyScalar(-membraneDent(t));
    } else if (!inWindow) release();
  }, -2);

  const { steel, grip, barrel, liquid: liquidMaterial } = materials;
  return (
    <group ref={root} scale={SCALE} visible={false}>
      <mesh position={[0, 0.07, 0]} rotation={[Math.PI, 0, 0]} material={steel.material}><coneGeometry args={[0.022, 0.14, 16]} /></mesh>
      <mesh position={[0, 0.44, 0]} material={steel.material}><cylinderGeometry args={[0.022, 0.022, 0.6, 16]} /></mesh>
      <mesh position={[0, 0.77, 0]} material={grip.material}><cylinderGeometry args={[0.07, 0.05, 0.14, 20]} /></mesh>
      <mesh position={[0, BARREL_START + BARREL_LENGTH / 2, 0]} material={barrel.material} renderOrder={6}><cylinderGeometry args={[0.12, 0.12, BARREL_LENGTH, 28, 1, true]} /></mesh>
      <mesh ref={liquid} position={[0, BARREL_START + BARREL_LENGTH / 2, 0]} material={liquidMaterial.material} renderOrder={5}><cylinderGeometry args={[0.105, 0.105, BARREL_LENGTH, 24]} /></mesh>
      <mesh position={[0, BARREL_START + BARREL_LENGTH + 0.025, 0]} material={grip.material}><cylinderGeometry args={[0.19, 0.19, 0.05, 28]} /></mesh>
      <group ref={plunger} position={[0, BARREL_START + BARREL_LENGTH, 0]}>
        <mesh material={grip.material}><cylinderGeometry args={[0.105, 0.105, 0.06, 24]} /></mesh>
        <mesh position={[0, 0.625, 0]} material={grip.material}><cylinderGeometry args={[0.03, 0.03, 1.25, 12]} /></mesh>
        <mesh position={[0, 1.25, 0]} material={grip.material}><cylinderGeometry args={[0.17, 0.17, 0.05, 24]} /></mesh>
      </group>
    </group>
  );
}
