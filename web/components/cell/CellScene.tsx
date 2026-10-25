"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CameraControls, CameraControlsImpl, ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { RotateCcw } from "lucide-react";
import * as THREE from "three";
import { useSim } from "@/lib/store";
import type { CellLocation, Target } from "@/lib/types";
import { DrugParticles } from "./DrugParticles";
import { Hotspot, LabelProjector } from "./Hotspot";
import { DRUG_ENTRY, ORGANELLES, membraneRadiusAt, organelleAnims } from "./layout";
import { AccessoryOrganelles, EndoplasmicReticulum, Golgi, Membrane, Mitochondria, Nucleus, Ribosomes } from "./Organelles";
import { ReasoningPath } from "./ReasoningPath";
import { createSquishState, deformPoint, stepSquish, type SquishState } from "./squish";

const HOME_CAMERA: [number, number, number, number, number, number] = [6, 5.4, 7, 0, 0, 0];
const FOV = 40;
const FIT_RADIUS = 3.9; // membrane plus a little margin

// Pull the home camera back on narrow (portrait) viewports so the whole cell fits horizontally.
function homeCamera(width: number, height: number): typeof HOME_CAMERA {
  const [x, y, z] = HOME_CAMERA;
  const halfWidth = Math.atan(Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * (width / Math.max(height, 1)));
  const scale = Math.max(1, FIT_RADIUS / Math.sin(halfWidth) / Math.hypot(x, y, z));
  return [x * scale, y * scale, z * scale, 0, 0, 0];
}
const LABEL_OFFSET = new THREE.Vector3(0, 0.22, 0);

function hotspotPosition(t: Target, index: number) {
  const base = ORGANELLES[t.cell_location].position.clone();
  if (t.cell_location === "membrane") {
    base.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), index * 0.5);
    return base.multiplyScalar(membraneRadiusAt(base));
  }
  // Keep the representative mitochondrial pin attached to the chosen instance.
  return base.add(new THREE.Vector3(index * 0.08, t.cell_location === "nucleus" ? 0.7 : 0.1, 0));
}

type Focus = (position: THREE.Vector3, radius: number, target?: string) => void;
interface InteractionProps {
  controls: RefObject<CameraControls | null>;
  squish: SquishState;
  active: boolean;
  focus: Focus;
  tooltip: RefObject<HTMLDivElement | null>;
  ruler: RefObject<HTMLDivElement | null>;
}

/** Native pointer capture supports the one-to-two-finger handoff without R3F's single-pointer limitation. */
function SceneInteraction({ controls, squish, active, focus, tooltip, ruler }: InteractionProps) {
  const { camera, scene, gl, size } = useThree();
  const hoverAnchor = useRef<THREE.Vector3 | null>(null);
  const scratch = useMemo(() => ({ point: new THREE.Vector3(), target: new THREE.Vector3(), direction: new THREE.Vector3() }), []);
  const proxy = useMemo(() => {
    const geometry = new THREE.SphereGeometry(1, 40, 28);
    const positions = geometry.attributes.position;
    const point = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).normalize();
      point.multiplyScalar(membraneRadiusAt(point));
      positions.setXYZ(i, point.x, point.y, point.z);
    }
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  }, []);
  const rest = useMemo(() => new Float32Array(proxy.geometry.attributes.position.array), [proxy]);

  useFrame((_, dt) => {
    stepSquish(squish, dt);
    const positions = proxy.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      scratch.point.fromArray(rest, i * 3);
      deformPoint(scratch.point, squish, 1, 1, scratch.point);
      positions.setXYZ(i, scratch.point.x, scratch.point.y, scratch.point.z);
    }
    positions.needsUpdate = true;
    proxy.geometry.computeBoundingSphere();
  }, -1);

  useFrame(() => {
    const label = tooltip.current;
    if (label && hoverAnchor.current && active) {
      deformPoint(hoverAnchor.current, squish, 0.18, 1.8, scratch.point).project(camera);
      const visible = scratch.point.z > -1 && scratch.point.z < 1 && Math.abs(scratch.point.x) < 1 && Math.abs(scratch.point.y) < 1;
      label.style.opacity = visible ? "1" : "0";
      label.style.transform = `translate(-50%, -100%) translate(${(scratch.point.x + 1) * size.width / 2}px,${(1 - scratch.point.y) * size.height / 2 - 16}px)`;
    }
    const scale = ruler.current;
    if (scale && controls.current && camera instanceof THREE.PerspectiveCamera) {
      controls.current.getTarget(scratch.target);
      camera.getWorldDirection(scratch.direction);
      const depth = Math.max(0.1, scratch.target.sub(camera.position).dot(scratch.direction));
      const unitsPerPixel = 2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV() / 2)) / size.height;
      const desired = 80 * unitsPerPixel * 5;
      const power = 10 ** Math.floor(Math.log10(desired));
      const length = [1, 2, 5, 10].map((n) => n * power).reduce((a, b) => Math.abs(a - desired) < Math.abs(b - desired) ? a : b);
      const bar = scale.firstElementChild as HTMLElement;
      const text = scale.lastElementChild as HTMLElement;
      bar.style.width = `${length / (unitsPerPixel * 5)}px`;
      text.textContent = `≈ ${Number(length.toPrecision(2))} µm`;
    }
  });

  const keys = useRef(new Set<string>());
  useEffect(() => {
    const held = keys.current;
    const down = (event: KeyboardEvent) => {
      const target = event.target;
      if (!active || event.ctrlKey || event.metaKey || event.altKey) return;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]")) return;
      held.add(event.key.toLowerCase());
    };
    const up = (event: KeyboardEvent) => { held.delete(event.key.toLowerCase()); };
    const clear = () => held.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      clear();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, [active]);

  useFrame((_, dt) => {
    const control = controls.current;
    const held = keys.current;
    if (!active || !control || !held.size) return;
    const step = Math.min(dt, 0.05);
    const zoom = (held.has("w") ? 1 : 0) - (held.has("s") ? 1 : 0);
    const slide = (held.has("a") ? 1 : 0) - (held.has("d") ? 1 : 0);
    if (zoom) void control.dolly(zoom * 20 * step, false);
    if (slide) void control.truck(-slide * 0.8 * control.distance * step, 0, false);
  });

  useEffect(() => {
    const canvas = gl.domElement;
    const control = controls.current;
    if (!control) return;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const plane = new THREE.Plane();
    const normal = new THREE.Vector3();
    const start = new THREE.Vector3();
    const current = new THREE.Vector3();
    const pointers = new Set<number>();
    const savedLeft = control.mouseButtons.left;
    const savedOne = control.touches.one;
    let pressed: { x: number; y: number; moved: number } | null = null;
    let suppressed = false;

    const restore = () => {
      control.mouseButtons.left = savedLeft;
      control.touches.one = savedOne;
      suppressed = false;
    };
    const ray = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2);
      raycaster.setFromCamera(pointer, camera);
    };
    const metadata = (object: THREE.Object3D) => {
      let node: THREE.Object3D | null = object;
      let owner: THREE.Object3D | null = null;
      while (node) {
        if (!node.visible || node.userData.detail || node.userData.membrane) return null;
        if (!owner && (node.userData.organelleLabel || node.userData.hotspot)) owner = node;
        node = node.parent;
      }
      return owner;
    };
    const pick = () => {
      const meshes: THREE.Object3D[] = [];
      scene.traverse((object) => { if (object instanceof THREE.Mesh && metadata(object)) meshes.push(object); });
      const hits = raycaster.intersectObjects(meshes, false);
      // Pins remain reachable through transparent organelles and the membrane.
      const hit = hits.find((h) => metadata(h.object)?.userData.hotspot) ?? hits[0];
      if (!hit) return null;
      const owner = metadata(hit.object);
      if (!owner) return null;
      const point = owner.getWorldPosition(new THREE.Vector3());
      if (hit.object instanceof THREE.InstancedMesh && hit.instanceId !== undefined) {
        const matrix = new THREE.Matrix4();
        hit.object.getMatrixAt(hit.instanceId, matrix);
        point.setFromMatrixPosition(matrix).applyMatrix4(hit.object.matrixWorld);
      }
      return { owner, point, label: String(owner.userData.targetName ?? owner.userData.organelleLabel ?? ""), radius: Number(owner.userData.focusRadius ?? 0.25) };
    };
    const hideHover = () => {
      hoverAnchor.current = null;
      if (tooltip.current) tooltip.current.style.opacity = "0";
      canvas.style.cursor = "grab";
    };
    const down = (event: PointerEvent) => {
      if (!active || (event.pointerType === "mouse" && event.button !== 0)) return;
      pointers.add(event.pointerId);
      if (pointers.size > 1) {
        squish.dragging = false;
        pressed = null;
        hideHover();
        return;
      }
      pressed = { x: event.clientX, y: event.clientY, moved: 0 };
      ray(event);
      const hit = raycaster.intersectObject(proxy, false)[0];
      if (!hit) return;
      control.stop();
      control.mouseButtons.left = CameraControlsImpl.ACTION.NONE;
      control.touches.one = CameraControlsImpl.ACTION.NONE;
      suppressed = true;
      squish.grab.copy(hit.point);
      squish.velocity.setScalar(0);
      squish.dragging = true;
      camera.getWorldDirection(normal);
      plane.setFromNormalAndCoplanarPoint(normal, hit.point);
      raycaster.ray.intersectPlane(plane, start);
      try { canvas.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
      canvas.style.cursor = "grabbing";
      hideHover();
    };
    const move = (event: PointerEvent) => {
      if (!active) return;
      ray(event);
      if (pressed) pressed.moved = Math.max(pressed.moved, Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y));
      if (squish.dragging && pointers.size === 1) {
        if (pressed && pressed.moved >= 4 && raycaster.ray.intersectPlane(plane, current)) {
          squish.offset.copy(current).sub(start).clampLength(0, 0.75);
          canvas.style.cursor = "grabbing";
        }
        return;
      }
      if (pointers.size) return;
      const hit = pick();
      if (hit && tooltip.current) {
        tooltip.current.textContent = hit.label;
        hoverAnchor.current = hit.point;
        canvas.style.cursor = "pointer";
      } else hideHover();
    };
    const finish = (event: PointerEvent) => {
      const click = event.type === "pointerup" && pressed && pressed.moved < 4 && pointers.size === 1;
      pointers.delete(event.pointerId);
      squish.dragging = false;
      if (click) {
        ray(event);
        const hit = pick();
        if (hit) focus(deformPoint(hit.point, squish, 0.18, 1.8), hit.radius, hit.owner.userData.targetName);
      }
      pressed = null;
      if (!pointers.size && suppressed) restore();
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      canvas.style.cursor = "grab";
    };
    canvas.style.touchAction = "none";
    canvas.style.cursor = active ? "grab" : "default";
    canvas.addEventListener("pointerdown", down, true);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
    canvas.addEventListener("lostpointercapture", finish);
    canvas.addEventListener("pointerleave", hideHover);
    return () => {
      squish.dragging = false;
      restore();
      hideHover();
      canvas.removeEventListener("pointerdown", down, true);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", finish);
      canvas.removeEventListener("pointercancel", finish);
      canvas.removeEventListener("lostpointercapture", finish);
      canvas.removeEventListener("pointerleave", hideHover);
    };
  }, [active, camera, controls, focus, gl, proxy, scene, squish, tooltip]);

  useEffect(() => () => { proxy.geometry.dispose(); proxy.material.dispose(); }, [proxy]);
  return null;
}

export function CellScene() {
  const { result, highlight, view, selectTarget } = useSim();
  const [membraneOpacity, setMembraneOpacity] = useState(100);
  const controls = useRef<CameraControls>(null);
  const container = useRef<HTMLDivElement>(null);
  const labels = useRef<(HTMLElement | null)[]>([]);
  const tooltip = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const navigation = useRef(0);
  const squish = useMemo(createSquishState, []);
  const anims = useMemo(() => organelleAnims(result?.effects ?? []), [result]);
  const targets = useMemo(() => (result?.targets ?? []).map((target, index) => ({ target, position: hotspotPosition(target, index) })), [result]);
  const surfaces = useMemo(() => targets.map(({ target }) => target.cell_location === "membrane"), [targets]);
  const path = useMemo(() => {
    if (!targets.length || !result) return { points: [] as THREE.Vector3[], surface: [] as boolean[] };
    const seen = new Set<CellLocation>([targets[0].target.cell_location]);
    const points = [DRUG_ENTRY.clone(), targets[0].position];
    const surface = [false, targets[0].target.cell_location === "membrane"];
    for (const effect of result.effects) {
      if (seen.has(effect.organelle)) continue;
      seen.add(effect.organelle);
      points.push(ORGANELLES[effect.organelle].position.clone());
      surface.push(effect.organelle === "membrane");
    }
    return { points, surface };
  }, [result, targets]);

  const resetView = useCallback(() => {
    navigation.current++;
    squish.dragging = false;
    squish.offset.setScalar(0);
    squish.velocity.setScalar(0);
    const box = container.current;
    void controls.current?.setLookAt(...(box ? homeCamera(box.clientWidth, box.clientHeight) : HOME_CAMERA), true);
  }, [squish]);
  useEffect(() => {
    navigation.current++;
    if (view !== "cell") return;
    // CameraControls attaches its ref a frame or two after the Canvas mounts.
    let frame = 0;
    const reset = () => {
      if (controls.current) resetView();
      else frame = requestAnimationFrame(reset);
    };
    reset();
    return () => cancelAnimationFrame(frame);
  }, [result, view, resetView]);

  useEffect(() => {
    if (view !== "cell") return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") resetView(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, resetView]);

  const focus = useCallback<Focus>(async (position, radius, target) => {
    const control = controls.current;
    if (!control) return;
    const token = ++navigation.current;
    const direction = control.getPosition(new THREE.Vector3()).sub(position).normalize();
    const distance = target ? 1.7 : Math.max(0.62, radius * 2.5);
    const eye = position.clone().addScaledVector(direction, distance);
    try {
      await control.setLookAt(eye.x, eye.y, eye.z, position.x, position.y, position.z, !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      if (target && token === navigation.current && useSim.getState().view === "cell") selectTarget(target);
    } catch { /* A newer camera gesture can interrupt a flight. */ }
  }, [selectTarget]);
  const props = { anims, highlight, squish, membraneOpacity: membraneOpacity / 100 };

  return (
    <div ref={container} className="absolute inset-0" aria-label="Interactive illustrative human cell">
      <div className={`pointer-events-none absolute left-4 right-4 top-4 z-10 ${view === "cell" ? "" : "hidden"}`}>
        <h2 className="font-heading text-4xl leading-none tracking-tight sm:text-5xl">Human cell<span className="text-brand">.</span></h2>
        <p className="mt-2 max-w-[260px] text-[10px] leading-relaxed text-muted-foreground">Illustrative human cell · Approximate scale; organelle counts reduced for clarity.</p>
      </div>
      <Canvas camera={{ position: HOME_CAMERA.slice(0, 3) as [number, number, number], fov: FOV, near: 0.01, far: 100 }} dpr={[1, 1.75]} gl={{ antialias: true }}>
        <color attach="background" args={["#efece6"]} />
        <hemisphereLight args={["#fffaf0", "#b3a395", 2.1]} />
        <directionalLight position={[4, 8, 5]} intensity={3.2} color="#fff8ed" />
        <Environment resolution={64} frames={1}>
          <Lightformer position={[0, 5, -3]} scale={[8, 8, 1]} intensity={2} />
          <Lightformer position={[-5, 1, 3]} rotation={[0, Math.PI / 2, 0]} scale={[5, 5, 1]} intensity={1.5} color="#fff1db" />
        </Environment>
        <Membrane {...props} />
        <Nucleus {...props} />
        <Mitochondria {...props} />
        <EndoplasmicReticulum {...props} />
        <Golgi {...props} />
        <Ribosomes {...props} />
        <AccessoryOrganelles {...props} />
        <ContactShadows position={[0, -2.05, 0]} opacity={0.24} scale={12} blur={2.8} far={5} resolution={128} color="#786454" />
        {targets.map(({ target, position }) => <Hotspot key={target.name} targetName={target.name} position={position} surface={target.cell_location === "membrane"} squish={squish} blocked={anims[target.cell_location].blocked} />)}
        <LabelProjector anchors={targets.map((t) => t.position)} labels={labels} squish={squish} surface={surfaces} offset={LABEL_OFFSET} />
        {targets[0] && <DrugParticles target={targets[0].position} squish={squish} surface={surfaces[0]} blocked={anims[targets[0].target.cell_location].blocked} />}
        <ReasoningPath points={path.points} surface={path.surface} squish={squish} />
        <CameraControls ref={controls} makeDefault minDistance={0.6} maxDistance={18} smoothTime={0.35} dollySpeed={5} dollyToCursor enabled={view === "cell"} touches={{ one: CameraControlsImpl.ACTION.TOUCH_ROTATE, two: CameraControlsImpl.ACTION.TOUCH_DOLLY_TRUCK, three: CameraControlsImpl.ACTION.TOUCH_TRUCK }} />
        <SceneInteraction controls={controls} squish={squish} active={view === "cell"} focus={focus} tooltip={tooltip} ruler={ruler} />
      </Canvas>
      <div ref={tooltip} role="status" className="pointer-events-none absolute left-0 top-0 z-20 whitespace-nowrap rounded border bg-card px-2.5 py-1.5 text-xs opacity-0 shadow-sm" />
      {targets.map(({ target, position }, i) => (
        <button key={target.name} ref={(el) => { labels.current[i] = el; }} onClick={() => focus(deformPoint(position, squish, surfaces[i] ? 1 : 0.18, surfaces[i] ? 1 : 1.8), 0.3, target.name)} className={`absolute left-0 top-0 z-10 whitespace-nowrap rounded border bg-card/95 px-2 py-1 text-[11px] shadow-sm transition-opacity hover:border-brand focus-visible:outline-2 focus-visible:outline-brand ${view === "cell" ? "" : "hidden"}`}>
          {target.name}{target.pdb_id && <span className="ml-1.5 font-mono text-[9px] text-muted-foreground">{target.pdb_id}</span>}
        </button>
      ))}
      <div className={`absolute bottom-4 right-4 z-10 w-44 rounded border bg-card/95 p-3 ${view === "cell" ? "" : "hidden"}`}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <label htmlFor="membrane-opacity" className="text-[11px] font-medium">Membrane</label>
          <button onClick={resetView} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand" aria-label="Reset cell view" title="Reset view"><RotateCcw size={13} /></button>
        </div>
        <div className="flex items-center gap-2">
          <input id="membrane-opacity" aria-label="Membrane opacity" type="range" min="0" max="100" value={membraneOpacity} onChange={(e) => setMembraneOpacity(Number(e.target.value))} className="h-1 w-full cursor-pointer accent-brand" />
          <output htmlFor="membrane-opacity" className="w-8 text-right font-mono text-[9px] text-muted-foreground">{membraneOpacity}%</output>
        </div>
        <div ref={ruler} className="mt-3 border-t pt-3 text-[9px] text-muted-foreground" aria-label="Approximate scale at focus depth"><div className="h-1.5 border-x border-b border-foreground" style={{ width: 80 }} /><span className="mt-1 block font-mono">≈ 5 µm</span></div>
      </div>
      <p className={`pointer-events-none absolute bottom-4 left-4 max-w-[calc(100%-13rem)] text-[9px] leading-relaxed text-muted-foreground ${view === "cell" ? "" : "hidden"}`}>Drag cell to squish<br />Drag background to orbit · Scroll or W/S to zoom · A/D to move · Esc to reset</p>
    </div>
  );
}
