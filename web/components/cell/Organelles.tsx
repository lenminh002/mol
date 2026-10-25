"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { CellLocation } from "@/lib/types";
import { useZoomReveal } from "./detail";
import { CENTROSOME_POSITION, GOLGI_POSITION, MITOCHONDRIA, NUCLEUS_RADIUS, ORGANELLES, animFactor, insideCell, membraneRadiusAt, seededRandom, type OrganelleAnim } from "./layout";
import { patchCellMaterial, type SquishState } from "./squish";

export interface AnatomyProps {
  anims: Record<CellLocation, OrganelleAnim>;
  highlight: string | null;
  squish: SquishState;
  membraneOpacity: number;
}

type MaterialPatch = NonNullable<Parameters<typeof patchCellMaterial>[2]>;

// Anatomy shares matte clay and one effect vocabulary; shader uniforms retain
// the shared mutable squish vectors, rather than scheduling React frame updates.
function useClayMaterial(props: AnatomyProps, location: CellLocation, color: string, patch: MaterialPatch = {}, opacity = 1, side: THREE.Side = THREE.FrontSide) {
  const patchKey = JSON.stringify(patch);
  const material = useMemo(() => {
    const next = new THREE.MeshPhysicalMaterial({ color, opacity, transparent: opacity < 1, roughness: 0.76, metalness: 0, sheen: 0.22, sheenColor: new THREE.Color("#fff7eb"), sheenRoughness: 0.9, specularIntensity: 0.25, side, depthWrite: opacity === 1, emissive: color, emissiveIntensity: 0.015 });
    patchCellMaterial(next, props.squish, JSON.parse(patchKey));
    return next;
  }, [color, opacity, side, props.squish, patchKey]);
  const colors = useMemo(() => ({ base: new THREE.Color(color), target: new THREE.Color(), tint: new THREE.Color() }), [color]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }, delta) => {
    const animation = props.anims[location];
    const factor = animFactor(animation, clock.elapsedTime, props.highlight === location);
    colors.target.copy(colors.base);
    if (animation.tint) colors.target.lerp(colors.tint.set(animation.tint), 0.42);
    colors.target.multiplyScalar(animation.intensity < 1 ? 0.88 : 1);
    material.color.lerp(colors.target, 1 - Math.exp(-delta * 7));
    material.emissive.copy(colors.target);
    material.emissiveIntensity = 0.018 * factor;
    material.wireframe = animation.dashed;
    material.opacity = opacity * (animation.dashed ? 0.6 : 1);
  });
  return material;
}

function useBreathe(props: AnatomyProps, location: CellLocation) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const animation = props.anims[location];
    group.current?.scale.setScalar(1 + (animation.pulse ? 0.014 * Math.sin(clock.elapsedTime * animation.pulse * Math.PI) : 0));
  });
  return group;
}

function InstanceCloud({ matrices, geometry, material, detail = false, renderOrder = 0 }: { matrices: THREE.Matrix4[]; geometry: THREE.BufferGeometry; material: THREE.MeshPhysicalMaterial; detail?: boolean; renderOrder?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    matrices.forEach((matrix, index) => ref.current!.setMatrixAt(index, matrix));
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [matrices]);
  return <instancedMesh ref={ref} args={[geometry, material, matrices.length]} userData={{ detail }} renderOrder={renderOrder} frustumCulled={false} />;
}

export function membraneGeometry(segments = 96) {
  const geometry = new THREE.SphereGeometry(1, segments, Math.max(32, Math.floor(segments * 0.6)));
  const positions = geometry.attributes.position;
  const point = new THREE.Vector3();
  for (let index = 0; index < positions.count; index++) {
    point.fromBufferAttribute(positions, index).normalize();
    point.multiplyScalar(membraneRadiusAt(point));
    positions.setXYZ(index, point.x, point.y, point.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function Membrane(props: AnatomyProps) {
  const geometry = useMemo(() => membraneGeometry(), []);
  const outer = useClayMaterial(props, "membrane", "#d89a52", { strength: 1, falloffScale: 1, fresnel: { min: 0.05, max: 0.92, power: 2.6 } });
  const inner = useClayMaterial(props, "cytoplasm", "#efd29e", { strength: 1, falloffScale: 1, fresnel: { min: 0.22, max: 0.55, power: 2.6 } }, 1, THREE.BackSide);
  useFrame(() => { outer.opacity *= props.membraneOpacity; inner.opacity *= props.membraneOpacity; });
  return <group userData={{ organelleLabel: "Cell membrane", focusRadius: 3, membrane: true }}>
    <mesh geometry={geometry} material={inner} scale={0.997} renderOrder={-5} frustumCulled={false} />
    <mesh geometry={geometry} material={outer} renderOrder={5} frustumCulled={false} />
  </group>;
}

function spiralPoints(count: number, radius: number) {
  const dummy = new THREE.Object3D();
  const matrices: THREE.Matrix4[] = [];
  for (let index = 0; index < count; index++) {
    const y = 1 - (2 * (index + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    dummy.position.set(Math.cos(angle) * r * radius, y * radius, Math.sin(angle) * r * radius);
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());
  }
  return matrices;
}

export function Nucleus(props: AnatomyProps) {
  const group = useBreathe(props, "nucleus");
  const reveal = useZoomReveal(ORGANELLES.nucleus.position, 1.1, 3.5);
  const details = useRef<THREE.Group>(null);
  const outer = useClayMaterial(props, "nucleus", "#bca6c8", { fresnel: { min: 0.6, max: 0.95, power: 2.6 }, reveal: { near: 1.1, far: 3.5, alpha: 0.06 } });
  const inner = useClayMaterial(props, "nucleus", "#cbb8d3", { fresnel: { min: 0.3, max: 0.8, power: 2.6 }, reveal: { near: 1.1, far: 3.5, alpha: 0.03 } }, 1, THREE.BackSide);
  const nucleolus = useClayMaterial(props, "nucleus", "#9775a8");
  const poreMaterial = useClayMaterial(props, "nucleus", "#7d748e", { detail: true, reveal: { near: 1.1, far: 3.5, alpha: 1 } });
  const chromatinMaterial = useClayMaterial(props, "nucleus", "#9d87ae", { detail: true, reveal: { near: 1.1, far: 3.5, alpha: 1 } });
  const pores = useMemo(() => spiralPoints(2400, NUCLEUS_RADIUS + 0.004), []);
  const poreGeometry = useMemo(() => new THREE.SphereGeometry(0.008, 6, 4), []);
  const chromatin = useMemo(() => {
    const random = seededRandom(2251);
    return Array.from({ length: 18 }, (_, index) => {
      const points: THREE.Vector3[] = [];
      const phase = random() * Math.PI * 2;
      const latitude = (random() - 0.5) * 1.5;
      for (let step = 0; step <= 24; step++) {
        const t = step / 24;
        const angle = phase + t * Math.PI * (1.5 + random() * 0.025);
        const radius = 0.36 + 0.16 * Math.sin(t * Math.PI * 3 + index);
        points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(latitude + t * 2.5) * 0.42, Math.sin(angle) * radius));
      }
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 56, 0.011, 5, false);
    });
  }, []);
  useFrame(() => { if (details.current) details.current.visible = reveal.current > 0.001; });
  return <group ref={group} position={ORGANELLES.nucleus.position} userData={{ organelleLabel: "Nucleus", focusRadius: 0.8 }}>
    <mesh material={outer} renderOrder={3} frustumCulled={false}><sphereGeometry args={[NUCLEUS_RADIUS, 64, 48]} /></mesh>
    <mesh material={inner} renderOrder={2} frustumCulled={false}><sphereGeometry args={[NUCLEUS_RADIUS - 0.032, 64, 48]} /></mesh>
    <mesh position={[0.12, -0.04, 0.18]} material={nucleolus} castShadow><sphereGeometry args={[0.19, 32, 24]} /></mesh>
    <group ref={details} visible={false} userData={{ detail: true }}>
      <InstanceCloud matrices={pores} geometry={poreGeometry} material={poreMaterial} detail renderOrder={4} />
      {chromatin.map((geometry, index) => <mesh key={index} geometry={geometry} material={chromatinMaterial} renderOrder={1} frustumCulled={false} />)}
    </group>
  </group>;
}

export function Mitochondria(props: AnatomyProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const detailGroup = useRef<THREE.Group>(null);
  const outer = useClayMaterial(props, "mitochondria", "#c87758", { fresnel: { min: 0.9, max: 0.98, power: 2.6 }, reveal: { near: 0.3, far: 2.3, alpha: 0.13 }, instanceReveal: true });
  const cristae = useClayMaterial(props, "mitochondria", "#e1b28b", { detail: true, reveal: { near: 0.3, far: 2.3, alpha: 1 }, instanceReveal: true });
  const geometry = useMemo(() => new THREE.CapsuleGeometry(0.055, 0.18, 5, 10), []);
  const plateGeometry = useMemo(() => new THREE.SphereGeometry(1, 10, 6), []);
  const { shells, plates } = useMemo(() => {
    const dummy = new THREE.Object3D();
    const shells: THREE.Matrix4[] = [];
    const plates: THREE.Matrix4[] = [];
    const local = new THREE.Matrix4();
    for (const placement of MITOCHONDRIA) {
      dummy.position.copy(placement.position); dummy.rotation.copy(placement.rotation); dummy.scale.setScalar(placement.scale); dummy.updateMatrix();
      const parent = dummy.matrix.clone(); shells.push(parent);
      for (let plate = 0; plate < 6; plate++) {
        dummy.position.set(plate % 2 ? 0.009 : -0.009, (plate - 2.5) * 0.032, 0);
        dummy.rotation.set(0, 0, plate % 2 ? 0.16 : -0.16); dummy.scale.set(0.043, 0.008, 0.04); dummy.updateMatrix();
        local.copy(parent).multiply(dummy.matrix); plates.push(local.clone());
      }
    }
    return { shells, plates };
  }, []);
  const sorting = useMemo(() => MITOCHONDRIA.map((placement, index) => ({ index, position: placement.position, distance: 0 })), []);
  const scratch = useMemo(() => ({ matrix: new THREE.Matrix4(), scale: new THREE.Vector3(), logicalIds: MITOCHONDRIA.map((_, index) => index) }), []);
  useFrame(({ camera, clock }) => {
    if (!ref.current) return;
    let nearest = Infinity;
    for (const entry of sorting) { entry.distance = camera.position.distanceToSquared(entry.position); nearest = Math.min(nearest, entry.distance); }
    sorting.sort((a, b) => b.distance - a.distance);
    const animation = props.anims.mitochondria;
    scratch.scale.setScalar(1 + (animation.pulse ? Math.sin(clock.elapsedTime * animation.pulse * Math.PI) * 0.014 : 0));
    sorting.forEach((entry, index) => { ref.current!.setMatrixAt(index, scratch.matrix.copy(shells[entry.index]).scale(scratch.scale)); scratch.logicalIds[index] = entry.index; });
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.userData.logicalIds = scratch.logicalIds;
    if (detailGroup.current) detailGroup.current.visible = nearest < 2.3 * 2.3;
  });
  return <group userData={{ organelleLabel: "Mitochondrion", focusRadius: 0.3 }}>
    <instancedMesh ref={ref} args={[geometry, outer, MITOCHONDRIA.length]} renderOrder={2} frustumCulled={false} userData={{ organelleLabel: "Mitochondrion", focusRadius: 0.3 }} />
    <group ref={detailGroup} visible={false} userData={{ detail: true }}><InstanceCloud matrices={plates} geometry={plateGeometry} material={cristae} detail renderOrder={1} /></group>
  </group>;
}

const ER_LAYERS = [-0.36, -0.13, 0.12, 0.35];

function erPoint(layer: number, u: number, v: number) {
  const angle = Math.PI * (0.11 + u * 1.78);
  const innerRadius = Math.sqrt(NUCLEUS_RADIUS * NUCLEUS_RADIUS - layer * layer) + 0.012;
  const radius = innerRadius + v * (0.5 + 0.065 * Math.sin(angle * 5));
  return new THREE.Vector3(Math.cos(angle) * radius, layer + v * (0.055 * Math.sin(angle * 6) + 0.025 * Math.cos(angle * 11)), Math.sin(angle) * radius);
}

function surfaceGeometry(pointAt: (u: number, v: number) => THREE.Vector3, uCount = 80, vCount = 12) {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let u = 0; u <= uCount; u++) for (let v = 0; v <= vCount; v++) positions.push(...pointAt(u / uCount, v / vCount).toArray());
  for (let u = 0; u < uCount; u++) for (let v = 0; v < vCount; v++) {
    const a = u * (vCount + 1) + v; const b = a + vCount + 1;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

export function EndoplasmicReticulum(props: AnatomyProps) {
  const group = useBreathe(props, "er");
  const material = useClayMaterial(props, "er", "#88a99e", {}, 1, THREE.DoubleSide);
  const smoothMaterial = useClayMaterial(props, "er", "#a7b9a2");
  const boundRibosomes = useClayMaterial(props, "er", "#687e70", { detail: true, reveal: { near: 1.2, far: 3.6, alpha: 1 }, instanceReveal: true });
  const reveal = useZoomReveal(ORGANELLES.nucleus.position, 1.2, 3.6);
  const details = useRef<THREE.Group>(null);
  const sheets = useMemo(() => ER_LAYERS.map((layer) => surfaceGeometry((u, v) => erPoint(layer, u, v))), []);
  const ribosomeGeometry = useMemo(() => new THREE.SphereGeometry(0.009, 6, 4), []);
  const ribosomes = useMemo(() => {
    const random = seededRandom(19387); const dummy = new THREE.Object3D();
    return Array.from({ length: 850 }, (_, index) => {
      dummy.position.copy(erPoint(ER_LAYERS[index % ER_LAYERS.length], random(), 0.08 + random() * 0.9)); dummy.position.y += 0.013; dummy.updateMatrix(); return dummy.matrix.clone();
    });
  }, []);
  const tubules = useMemo(() => {
    const random = seededRandom(7642);
    return Array.from({ length: 19 }, (_, index) => {
      const angle = Math.PI * (0.65 + (index / 18) * 0.85); const points: THREE.Vector3[] = [];
      for (let step = 0; step <= 9; step++) {
        const t = step / 9; const radial = 1.12 + t * (0.45 + (index % 4) * 0.12); const curvedAngle = angle + Math.sin(t * 4 + index) * 0.12;
        points.push(new THREE.Vector3(Math.cos(curvedAngle) * radial, -0.28 + (index % 5) * 0.13 + Math.sin(t * 6 + index) * 0.07, Math.sin(curvedAngle) * radial));
      }
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 42, 0.025 + random() * 0.009, 7, false);
    });
  }, []);
  useFrame(() => { if (details.current) details.current.visible = reveal.current > 0.001; });
  return <group ref={group} position={ORGANELLES.nucleus.position}>
    <group userData={{ organelleLabel: "Rough endoplasmic reticulum", focusRadius: 1.35 }}>
      {sheets.map((geometry, index) => <mesh key={index} geometry={geometry} material={material} castShadow receiveShadow frustumCulled={false} />)}
      <group ref={details} visible={false} userData={{ detail: true }}><InstanceCloud matrices={ribosomes} geometry={ribosomeGeometry} material={boundRibosomes} detail renderOrder={1} /></group>
    </group>
    <group userData={{ organelleLabel: "Smooth endoplasmic reticulum", focusRadius: 1.6 }}>{tubules.map((geometry, index) => <mesh key={index} geometry={geometry} material={smoothMaterial} castShadow frustumCulled={false} />)}</group>
  </group>;
}

export function Golgi(props: AnatomyProps) {
  const material = useClayMaterial(props, "cytoplasm", "#8f86c5", {}, 1, THREE.DoubleSide);
  const vesicleMaterial = useClayMaterial(props, "cytoplasm", "#b4a5d4", { detail: true, reveal: { near: 0.8, far: 3.2, alpha: 1 } });
  const reveal = useZoomReveal(GOLGI_POSITION, 0.8, 3.2); const details = useRef<THREE.Group>(null);
  const facing = Math.atan2(ORGANELLES.nucleus.position.z - GOLGI_POSITION.z, ORGANELLES.nucleus.position.x - GOLGI_POSITION.x);
  const cisternae = useMemo(() => Array.from({ length: 5 }, (_, index) => surfaceGeometry((u, v) => {
    const angle = -1.3 + u * 2.6; const radius = 0.27 + v * 0.15 + index * 0.012;
    return new THREE.Vector3(Math.cos(angle) * radius - index * 0.04, (index - 2) * 0.105 + Math.sin(u * Math.PI) * 0.025 + Math.sin(angle * 2) * v * 0.018, Math.sin(angle) * radius * (0.85 - index * 0.045));
  }, 48, 8)), []);
  const vesicles = useMemo(() => { const random = seededRandom(952); return Array.from({ length: 17 }, () => new THREE.Vector3(-0.3 - random() * 0.3, (random() - 0.5) * 0.6, (random() - 0.5) * 0.7)); }, []);
  useFrame(() => { if (details.current) details.current.visible = reveal.current > 0.001; });
  return <group position={GOLGI_POSITION} rotation={[0, -facing, 0]} userData={{ organelleLabel: "Golgi apparatus", focusRadius: 0.65 }}>
    {cisternae.map((geometry, index) => <mesh key={index} geometry={geometry} material={material} castShadow receiveShadow frustumCulled={false} />)}
    <group ref={details} visible={false} userData={{ detail: true }}>{vesicles.map((position, index) => <mesh key={index} position={position} material={vesicleMaterial} renderOrder={1}><sphereGeometry args={[0.035 + (index % 3) * 0.009, 12, 8]} /></mesh>)}</group>
  </group>;
}

export function Ribosomes(props: AnatomyProps) {
  const material = useClayMaterial(props, "cytoplasm", "#a09278", { detail: true, reveal: { near: 0.3, far: 2.6, alpha: 1 }, instanceReveal: true });
  const geometry = useMemo(() => new THREE.SphereGeometry(0.009, 6, 4), []);
  const matrices = useMemo(() => {
    const random = seededRandom(48572); const dummy = new THREE.Object3D(); const matrices: THREE.Matrix4[] = [];
    for (let attempt = 0; matrices.length < 600 && attempt < 12000; attempt++) {
      dummy.position.set((random() - 0.5) * 5.6, (random() - 0.5) * 3, (random() - 0.5) * 5.6);
      if (!insideCell(dummy.position, 0.18) || dummy.position.distanceTo(ORGANELLES.nucleus.position) < 1.3) continue;
      dummy.scale.setScalar(0.75 + random() * 0.5); dummy.updateMatrix(); matrices.push(dummy.matrix.clone());
    }
    return matrices;
  }, []);
  return <group userData={{ detail: true }}><InstanceCloud matrices={matrices} geometry={geometry} material={material} detail renderOrder={1} /></group>;
}

export function AccessoryOrganelles(props: AnatomyProps) {
  const lysosomeMaterial = useClayMaterial(props, "cytoplasm", "#c5aa67", { fresnel: { min: 0.88, max: 0.98, power: 2.6 }, reveal: { near: 0.35, far: 1.9, alpha: 0.2 } });
  const peroxisomeMaterial = useClayMaterial(props, "cytoplasm", "#93aa8c", { fresnel: { min: 0.88, max: 0.98, power: 2.6 }, reveal: { near: 0.35, far: 1.9, alpha: 0.2 } });
  const granuleMaterial = useClayMaterial(props, "cytoplasm", "#99865b", { detail: true, reveal: { near: 0.35, far: 1.9, alpha: 1 }, instanceReveal: true });
  const centrioleMaterial = useClayMaterial(props, "cytoplasm", "#c39a67");
  const microtubuleMaterial = useClayMaterial(props, "cytoplasm", "#b9a581", { detail: true, reveal: { near: 0.9, far: 3.3, alpha: 1 } }, 0.5);
  const vesicleMaterial = useClayMaterial(props, "cytoplasm", "#d7bea7", { strength: 0.18 }, 0.88);
  const reveal = useZoomReveal(CENTROSOME_POSITION, 0.9, 3.3); const microtubulesRef = useRef<THREE.Group>(null);
  const { bodies, granules, vesicles } = useMemo(() => {
    const random = seededRandom(83712); const dummy = new THREE.Object3D();
    const bodies: { position: THREE.Vector3; radius: number; peroxisome: boolean }[] = []; const granules: THREE.Matrix4[] = []; const vesicles: THREE.Matrix4[] = [];
    for (let attempt = 0; bodies.length < 20 && attempt < 5000; attempt++) {
      const position = new THREE.Vector3((random() - 0.5) * 4.9, (random() - 0.5) * 2.7, (random() - 0.5) * 4.9);
      if (!insideCell(position, 0.28) || position.distanceTo(ORGANELLES.nucleus.position) < 1.4 || position.distanceTo(GOLGI_POSITION) < 0.65) continue;
      const radius = 0.065 + random() * 0.055; bodies.push({ position, radius, peroxisome: bodies.length % 2 === 0 });
      for (let index = 0; index < 14; index++) {
        const direction = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
        dummy.position.copy(position).addScaledVector(direction, random() * radius * 0.65); dummy.scale.setScalar(0.012 + random() * 0.006); dummy.updateMatrix(); granules.push(dummy.matrix.clone());
      }
    }
    for (let attempt = 0; vesicles.length < 28 && attempt < 5000; attempt++) {
      dummy.position.set((random() - 0.5) * 5.2, (random() - 0.5) * 2.7, (random() - 0.5) * 5.2);
      if (!insideCell(dummy.position, 0.2) || dummy.position.distanceTo(ORGANELLES.nucleus.position) < 1.4) continue;
      dummy.scale.setScalar(0.025 + random() * 0.025); dummy.updateMatrix(); vesicles.push(dummy.matrix.clone());
    }
    return { bodies, granules, vesicles };
  }, []);
  const granuleGeometry = useMemo(() => new THREE.SphereGeometry(1, 6, 4), []);
  const vesicleGeometry = useMemo(() => new THREE.SphereGeometry(1, 10, 8), []);
  const microtubules = useMemo(() => {
    const random = seededRandom(1471);
    return Array.from({ length: 24 }, (_, index) => {
      const angle = (index / 24) * Math.PI * 2; const points: THREE.Vector3[] = [new THREE.Vector3()];
      const destination = new THREE.Vector3(Math.cos(angle) * 2.2, (random() - 0.5) * 2.25, Math.sin(angle) * 2.2);
      for (let step = 1; step <= 7; step++) {
        const t = step / 7; const point = destination.clone().multiplyScalar(t); point.y += Math.sin(t * Math.PI) * 0.18;
        const world = point.clone().add(CENTROSOME_POSITION);
        if (!insideCell(world, 0.2)) break;
        if (world.distanceTo(ORGANELLES.nucleus.position) < 0.84) {
          world.sub(ORGANELLES.nucleus.position).setLength(0.84).add(ORGANELLES.nucleus.position);
          point.copy(world).sub(CENTROSOME_POSITION);
        }
        points.push(point);
      }
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 28, 0.006, 4, false);
    });
  }, []);
  useFrame(() => { if (microtubulesRef.current) microtubulesRef.current.visible = reveal.current > 0.001; });
  return <group>
    {bodies.map(({ position, radius, peroxisome }, index) => <group key={index} position={position} userData={{ organelleLabel: peroxisome ? "Peroxisome" : "Lysosome", focusRadius: 0.25 }}><mesh material={peroxisome ? peroxisomeMaterial : lysosomeMaterial} renderOrder={2}><sphereGeometry args={[radius, 18, 12]} /></mesh></group>)}
    <group userData={{ detail: true }}><InstanceCloud matrices={granules} geometry={granuleGeometry} material={granuleMaterial} detail renderOrder={1} /></group>
    <group userData={{ organelleLabel: "Transport vesicle", focusRadius: 0.2 }}><InstanceCloud matrices={vesicles} geometry={vesicleGeometry} material={vesicleMaterial} /></group>
    <group position={CENTROSOME_POSITION} userData={{ organelleLabel: "Centrosome", focusRadius: 0.4 }}>
      {[0, 1].map((axis) => <group key={axis} position={[axis * 0.12, 0, 0]} rotation={axis ? [0, 0, Math.PI / 2] : [0, 0, 0]}>{Array.from({ length: 9 }, (_, index) => {
        const angle = (index / 9) * Math.PI * 2;
        return <mesh key={index} position={[Math.cos(angle) * 0.047, 0, Math.sin(angle) * 0.047]} material={centrioleMaterial} castShadow><cylinderGeometry args={[0.012, 0.012, 0.19, 6]} /></mesh>;
      })}</group>)}
      <group ref={microtubulesRef} visible={false} userData={{ detail: true }}>{microtubules.map((geometry, index) => <mesh key={index} geometry={geometry} material={microtubuleMaterial} renderOrder={1} frustumCulled={false} />)}</group>
    </group>
  </group>;
}
