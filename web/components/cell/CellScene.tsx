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
import { PHASE, effectTimings, timelineDuration } from "./effectTimeline";
import { DIRECTION_TINT, DRUG_ENTRY, TARGET_COLOR, ORGANELLES, ORGANELLE_LOCATION, membraneRadiusAt, organelleAnims } from "./layout";
import { Needle } from "./Needle";
import { resetPlayback } from "./playback";
import { AccessoryOrganelles, EndoplasmicReticulum, Golgi, Membrane, Mitochondria, Nucleus, Ribosomes } from "./Organelles";
import { ReasoningPath } from "./ReasoningPath";
import { TargetCopies } from "./TargetCopies";
import { SignalWaves, type WaveSpec } from "./SignalWave";
import { PlaybackDriver, TimeGate } from "./TimeGate";
import { createSquishState, deformPoint, stepSquish, type SquishState } from "./squish";

const FOV = 28; // narrow lens keeps close organelles from stretching toward the screen edges
// Direction of the original 40° framing, pulled back so the overview fills the same area at the narrower FOV.
const HOME_SCALE = Math.tan(THREE.MathUtils.degToRad(20)) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const HOME_CAMERA: [number, number, number, number, number, number] = [6 * HOME_SCALE, 5.4 * HOME_SCALE, 7 * HOME_SCALE, 0, 0, 0];
const FIT_RADIUS = 3.9; // membrane plus a little margin

// Pull the home camera back on narrow (portrait) viewports so the whole cell fits horizontally.
function homeCamera(width: number, height: number): typeof HOME_CAMERA {
  const [x, y, z] = HOME_CAMERA;
  const halfWidth = Math.atan(Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * (width / Math.max(height, 1)));
  const scale = Math.max(1, FIT_RADIUS / Math.sin(halfWidth) / Math.hypot(x, y, z));
  return [x * scale, y * scale, z * scale, 0, 0, 0];
}
const DIRECTION_ARROW = { up: "↑", down: "↓", block: "⊘" } as const;
const DIRECTION_LABEL = { up: "Increased", down: "Decreased", block: "Blocked (inhibited)" } as const;
const LABEL_OFFSET = new THREE.Vector3(0, 0.22, 0);

// `sibling` counts earlier pins in the same region, so several targets there don't overlap.
function hotspotPosition(t: Target, sibling: number) {
  const base = ORGANELLES[t.cell_location].position.clone();
  if (t.cell_location === "membrane") {
    base.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), sibling * 0.6);
    return base.multiplyScalar(membraneRadiusAt(base));
  }
  // Keep the representative mitochondrial pin attached to the chosen instance.
  const spread = sibling === 0 ? 0 : 0.6 * Math.ceil(sibling / 2) * (sibling % 2 ? 1 : -1);
  const lift = (t.cell_location === "nucleus" ? 0.7 : 0.1) - 0.3 * sibling;
  return base.add(new THREE.Vector3(spread, lift, sibling * 0.12));
}

type Focus = (position: THREE.Vector3, radius: number, target?: string) => void;
interface InteractionProps {
  controls: RefObject<CameraControls | null>;
  squish: SquishState;
  active: boolean;
  focus: Focus;
  flying: RefObject<boolean>;
  tooltip: RefObject<HTMLDivElement | null>;
  ruler: RefObject<HTMLDivElement | null>;
  onHover: (card: string | null) => void;
}

/** Native pointer capture supports the one-to-two-finger handoff without R3F's single-pointer limitation. */
function SceneInteraction({ controls, squish, active, focus, flying, tooltip, ruler, onHover }: InteractionProps) {
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
    return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
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
      // Shift turns the left-drag into a pan; camera-controls has no modifier mapping of its own.
      if (event.key === "Shift" && controls.current && !squish.dragging) controls.current.mouseButtons.left = CameraControlsImpl.ACTION.TRUCK;
    };
    const panOff = () => { if (controls.current && !squish.dragging) controls.current.mouseButtons.left = CameraControlsImpl.ACTION.ROTATE; };
    const up = (event: KeyboardEvent) => {
      held.delete(event.key.toLowerCase());
      if (event.key === "Shift") panOff();
    };
    const clear = () => { held.clear(); panOff(); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      clear();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, [active, controls, squish]);

  // Dolly-to-cursor drags the pivot toward whatever was zoomed on; ease it back to the cell
  // centre as the camera retreats so zooming out always recovers a centred overview.
  // Skipped during programmatic flights: an instant setLookAt overwrites the flight's goal and stalls it.
  useFrame((_, dt) => {
    const control = controls.current;
    if (!active || !control || squish.dragging || flying.current) return;
    const pull = THREE.MathUtils.smoothstep(control.distance, 3, 7);
    if (pull <= 0) return;
    control.getTarget(scratch.target);
    if (scratch.target.lengthSq() < 1e-6) return;
    // Shift camera and pivot together so the view direction never rotates (no perspective swing).
    const shift = (1 - Math.exp(-dt * 6)) * pull;
    if (scratch.target.length() * shift < 1e-4) return;
    control.getPosition(scratch.point);
    void control.setLookAt(
      scratch.point.x - scratch.target.x * shift, scratch.point.y - scratch.target.y * shift, scratch.point.z - scratch.target.z * shift,
      scratch.target.x * (1 - shift), scratch.target.y * (1 - shift), scratch.target.z * (1 - shift),
      false,
    );
  });

  useFrame((_, dt) => {
    const control = controls.current;
    const held = keys.current;
    if (!active || !control || !held.size) return;
    const step = Math.min(dt, 0.05);
    const zoom = (held.has("w") ? 1 : 0) - (held.has("s") ? 1 : 0);
    const slide = (held.has("a") ? 1 : 0) - (held.has("d") ? 1 : 0);
    const lift = (held.has("q") ? 1 : 0) - (held.has("e") ? 1 : 0);
    if (zoom) void control.dolly(zoom * 0.6 * control.distance * step, false);
    // Floor the pan speed so it stays usable when zoomed inside the cell.
    const pan = 0.2 * Math.max(control.distance, 3) * step;
    if (slide || lift) void control.truck(-slide * pan, -lift * pan, false);
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
      // Pins remain reachable through transparent organelles and the membrane, but not through
      // a mitochondrion in front of them: its solid capsule should take the click.
      const pin = hits.find((h) => metadata(h.object)?.userData.hotspot);
      const blocker = pin && hits.find((h) => metadata(h.object)?.userData.organelleLabel === "Mitochondrion" && h.distance < pin.distance);
      const hit = blocker ?? pin ?? hits[0];
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
    // Only clear a highlight this canvas set, so label hover isn't wiped on pointer leave.
    let canvasHighlight = false;
    const clearCanvasHighlight = () => {
      if (canvasHighlight) useSim.getState().setHighlight(null);
      canvasHighlight = false;
    };
    const hideHover = () => {
      hoverAnchor.current = null;
      onHover(null);
      if (tooltip.current) tooltip.current.style.opacity = "0";
      canvas.style.cursor = "grab";
    };
    const down = (event: PointerEvent) => {
      if (!active || event.shiftKey || (event.pointerType === "mouse" && event.button !== 0)) return;
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
        const key = ORGANELLE_LOCATION[hit.label] ?? null;
        if (useSim.getState().highlight !== key) useSim.getState().setHighlight(key);
        canvasHighlight = key !== null;
        const targetName = hit.owner.userData.targetName;
        onHover(targetName ? `t:${targetName}` : key ? `e:${key}` : null);
      } else {
        hideHover();
        clearCanvasHighlight();
      }
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
    const leave = () => { hideHover(); clearCanvasHighlight(); };
    canvas.addEventListener("pointerleave", leave);
    return () => {
      squish.dragging = false;
      restore();
      hideHover();
      clearCanvasHighlight();
      canvas.removeEventListener("pointerdown", down, true);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", finish);
      canvas.removeEventListener("pointercancel", finish);
      canvas.removeEventListener("lostpointercapture", finish);
      canvas.removeEventListener("pointerleave", leave);
    };
  }, [active, camera, controls, focus, gl, onHover, proxy, scene, squish, tooltip]);

  useEffect(() => () => { proxy.geometry.dispose(); proxy.material.dispose(); }, [proxy]);
  return null;
}

/** Detail layers start hidden, so their shaders would otherwise compile on the first zoom-in and stall a frame. */
function PrewarmShaders() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const hidden: THREE.Object3D[] = [];
      scene.traverse((object) => { if (object.userData.detail && !object.visible) { object.visible = true; hidden.push(object); } });
      gl.compile(scene, camera);
      hidden.forEach((object) => { object.visible = false; });
    });
    return () => cancelAnimationFrame(frame);
  }, [gl, scene, camera]);
  return null;
}

export function CellScene() {
  const { result, highlight, isolateOnHover, showLabels, view, selectTarget, setHighlight } = useSim();
  const [membraneOpacity, setMembraneOpacity] = useState(100);
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);
  const controls = useRef<CameraControls>(null);
  const container = useRef<HTMLDivElement>(null);
  const labels = useRef<(HTMLElement | null)[]>([]);
  const effectLabels = useRef<(HTMLElement | null)[]>([]);
  const tooltip = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const navigation = useRef(0);
  const flying = useRef(false);
  const squish = useMemo(createSquishState, []);
  const anims = useMemo(() => organelleAnims(result?.effects ?? [], result?.targets[0]?.cell_location), [result]);
  const targets = useMemo(() => {
    const seen = new Map<CellLocation, number>();
    return (result?.targets ?? []).map((target) => {
      const sibling = seen.get(target.cell_location) ?? 0;
      seen.set(target.cell_location, sibling + 1);
      return { target, position: hotspotPosition(target, sibling), offTarget: target.role === "off_target" };
    });
  }, [result]);
  const surfaces = useMemo(() => targets.map(({ target }) => target.cell_location === "membrane"), [targets]);
  const path = useMemo(() => {
    if (!targets.length || !result) return { points: [] as THREE.Vector3[], surface: [] as boolean[], organelles: [] as (CellLocation | null)[] };
    const seen = new Set<CellLocation>([targets[0].target.cell_location]);
    const points = [DRUG_ENTRY.clone(), targets[0].position];
    const surface = [false, targets[0].target.cell_location === "membrane"];
    const organelles: (CellLocation | null)[] = [null, null];
    for (const effect of result.effects) {
      if (seen.has(effect.organelle)) continue;
      seen.add(effect.organelle);
      points.push(ORGANELLES[effect.organelle].position.clone());
      surface.push(effect.organelle === "membrane");
      organelles.push(effect.organelle);
    }
    return { points, surface, organelles };
  }, [result, targets]);

  // Downstream path stops: one per organelle, labelled with its strongest effect.
  const effectNodes = useMemo(() => {
    if (!result) return [];
    const timings = effectTimings(result.effects);
    const best = new Map<CellLocation, number>();
    result.effects.forEach((e, i) => {
      const current = best.get(e.organelle);
      if (current === undefined || e.magnitude * e.confidence > result.effects[current].magnitude * result.effects[current].confidence) best.set(e.organelle, i);
    });
    const targetLocation = targets[0]?.target.cell_location;
    return [...best].filter(([organelle]) => organelle !== targetLocation).map(([organelle, index]) => ({
      organelle,
      effect: result.effects[index],
      position: ORGANELLES[organelle].position.clone(),
      onset: timings[index].onset,
    })).sort((a, b) => a.onset - b.onset);
  }, [result, targets]);

  // Path dots take their label's direction colour; the drug entry and target keep the neutral accent.
  const pathColors = useMemo(() => path.organelles.map((organelle) => {
    const node = organelle && effectNodes.find((n) => n.organelle === organelle);
    return node ? DIRECTION_TINT[node.effect.direction] : undefined;
  }), [path, effectNodes]);

  const waves = useMemo<WaveSpec[]>(() => {
    if (!result || !targets.length) return [];
    const origin = targets[0].target.cell_location;
    const timings = effectTimings(result.effects);
    const seen = new Set<CellLocation>();
    const out: WaveSpec[] = [];
    result.effects.forEach((effect, index) => {
      if (seen.has(effect.organelle)) return;
      seen.add(effect.organelle);
      out.push({ to: ORGANELLES[effect.organelle].position, onset: timings[index].onset, color: DIRECTION_TINT[effect.direction], inPlace: effect.organelle === origin });
    });
    return out;
  }, [result, targets]);

  // Only focus a card that exists, so hovering an organelle without one doesn't fade every card.
  const focusedCard = useMemo(() => {
    if (!hoveredLabel) return null;
    const cards = [...targets.map(({ target }) => `t:${target.name}`), ...effectNodes.map(({ organelle }) => `e:${organelle}`)];
    return cards.includes(hoveredLabel) ? hoveredLabel : null;
  }, [hoveredLabel, targets, effectNodes]);

  // Every new result (or loaded run) restarts the injection; reduced motion jumps to the end state.
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resetPlayback(timelineDuration(result?.effects ?? []), !result ? "idle" : reduced ? "end" : "play");
  }, [result]);

  const resetView = useCallback(() => {
    const token = ++navigation.current;
    squish.dragging = false;
    squish.offset.setScalar(0);
    squish.velocity.setScalar(0);
    const box = container.current;
    flying.current = true;
    void controls.current?.setLookAt(...(box ? homeCamera(box.clientWidth, box.clientHeight) : HOME_CAMERA), true)
      .catch(() => {})
      .finally(() => { if (token === navigation.current) flying.current = false; });
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
    const distance = target ? 2.2 : Math.max(0.62, radius * 2.5);
    const eye = position.clone().addScaledVector(direction, distance);
    flying.current = true;
    try {
      await control.setLookAt(eye.x, eye.y, eye.z, position.x, position.y, position.z, !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      if (token === navigation.current) flying.current = false;
      const hasStructure = useSim.getState().result?.targets.some((t) => t.name === target && t.pdb_id);
      if (target && hasStructure && token === navigation.current && useSim.getState().view === "cell") selectTarget(target);
    } catch {
      /* A newer camera gesture can interrupt a flight. */
      if (token === navigation.current) flying.current = false;
    }
  }, [selectTarget]);
  const props = { anims, highlight, squish, membraneOpacity: membraneOpacity / 100, isolateOnHover };

  return (
    <div ref={container} className="absolute inset-0" aria-label="Interactive illustrative human cell">
      <div className={`pointer-events-none absolute left-4 right-4 top-4 z-10 ${view === "cell" ? "" : "hidden"}`}>
        <h2 className="font-heading text-4xl leading-none tracking-tight sm:text-5xl">Human cell<span className="text-brand">.</span></h2>
        <p className="mt-2 max-w-[260px] text-[10px] leading-relaxed text-muted-foreground">Illustrative human cell · Approximate scale; organelle counts reduced for clarity.</p>
      </div>
      <Canvas camera={{ position: HOME_CAMERA.slice(0, 3) as [number, number, number], fov: FOV, near: 0.2, far: 100 }} dpr={[1, 1.5]} gl={{ antialias: true }}>
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
        {targets.map(({ target, position, offTarget }) => <Hotspot key={target.name} targetName={target.name} offTarget={offTarget} position={position} surface={target.cell_location === "membrane"} squish={squish} flashAt={PHASE.bind} />)}
        {targets[0] && <TargetCopies location={targets[0].target.cell_location} color={TARGET_COLOR} squish={squish} />}
        <LabelProjector anchors={targets.map((t) => t.position)} labels={labels} squish={squish} surface={surfaces} offset={LABEL_OFFSET} />
        <LabelProjector anchors={effectNodes.map((n) => n.position)} labels={effectLabels} squish={squish} surface={effectNodes.map((n) => n.organelle === "membrane")} offset={LABEL_OFFSET} showAt={effectNodes.map((n) => n.onset)} />
        {targets[0] && <DrugParticles target={targets[0].position} squish={squish} surface={surfaces[0]} blocked={anims[targets[0].target.cell_location].blocked} />}
        {result && <Needle squish={squish} />}
        {targets[0] && <SignalWaves from={targets[0].position} waves={waves} squish={squish} />}
        <TimeGate from={PHASE.cascadeStart}><ReasoningPath points={path.points} surface={path.surface} colors={pathColors} squish={squish} /></TimeGate>
        <PlaybackDriver />
        <PrewarmShaders />
        <CameraControls ref={controls} makeDefault minDistance={1} maxDistance={26} smoothTime={0.35} dollySpeed={5} dollyToCursor enabled={view === "cell"} touches={{ one: CameraControlsImpl.ACTION.TOUCH_ROTATE, two: CameraControlsImpl.ACTION.TOUCH_DOLLY_TRUCK, three: CameraControlsImpl.ACTION.TOUCH_TRUCK }} />
        <SceneInteraction controls={controls} squish={squish} active={view === "cell"} focus={focus} flying={flying} tooltip={tooltip} ruler={ruler} onHover={setHoveredLabel} />
      </Canvas>
      <div ref={tooltip} role="status" className="pointer-events-none absolute left-0 top-0 z-20 whitespace-nowrap rounded border bg-card px-2.5 py-1.5 text-xs opacity-0 shadow-sm" />
      {targets.map(({ target, position, offTarget }, i) => (
        <button key={target.name} ref={(el) => { labels.current[i] = el; }} title={offTarget ? "Off-target: the drug also binds this protein, though it isn't the intended target. This can cause side effects." : undefined} onMouseEnter={() => { setHoveredLabel(`t:${target.name}`); setHighlight(target.cell_location); }} onMouseLeave={() => { setHoveredLabel(null); setHighlight(null); }} onClick={() => focus(deformPoint(position, squish, surfaces[i] ? 1 : 0.18, surfaces[i] ? 1 : 1.8), 0.3, target.name)} className={`absolute left-0 top-0 z-10 whitespace-nowrap rounded border bg-card/95 px-2 py-1 text-[11px] shadow-sm transition-[filter] hover:border-brand focus-visible:outline-2 focus-visible:outline-brand ${offTarget ? "border-dashed text-muted-foreground" : ""} ${focusedCard === `t:${target.name}` ? "!z-30" : focusedCard ? "[filter:opacity(0.07)]" : ""} ${view === "cell" && showLabels ? "" : "hidden"}`}>
          {offTarget && focusedCard === `t:${target.name}` && <span className="mr-1.5 text-[9px] uppercase tracking-wide">off-target</span>}{target.name}{target.pdb_id && focusedCard === `t:${target.name}` && <span className="ml-1.5 font-mono text-[9px] text-muted-foreground">{target.pdb_id}</span>}
        </button>
      ))}
      {effectNodes.map(({ organelle, effect, position }, i) => (
        <button
          key={organelle}
          ref={(el) => { effectLabels.current[i] = el; }}
          title={effect.explanation}
          onClick={() => focus(deformPoint(position, squish, organelle === "membrane" ? 1 : 0.18, organelle === "membrane" ? 1 : 1.8), 0.5)}
          onMouseEnter={() => { setHoveredLabel(`e:${organelle}`); setHighlight(organelle); }}
          onMouseLeave={() => { setHoveredLabel(null); setHighlight(null); }}
          className={`absolute left-0 top-0 z-10 max-w-56 whitespace-nowrap rounded border bg-card/95 px-2 py-1 text-left text-[11px] shadow-sm transition-[filter] hover:border-brand focus-visible:outline-2 focus-visible:outline-brand ${focusedCard === `e:${organelle}` ? "!z-30" : focusedCard ? "[filter:opacity(0.07)]" : ""} ${view === "cell" && showLabels ? "" : "hidden"}`}
          style={{ borderLeft: `3px solid ${DIRECTION_TINT[effect.direction]}`, visibility: "hidden" }}
        >
          <span className="font-medium">{ORGANELLES[organelle].label} {DIRECTION_ARROW[effect.direction]}</span>
          <span className="ml-1.5 block max-w-52 truncate text-[10px] text-muted-foreground">{effect.pathway}</span>
        </button>
      ))}
      {(effectNodes.length > 0 || targets.length > 0) && (
        <ul aria-label="Colour key" className={`pointer-events-none absolute bottom-4 left-4 z-10 w-48 space-y-1 p-3 text-[10px] text-muted-foreground ${view === "cell" ? "" : "hidden"}`}>
          <li className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: TARGET_COLOR }} />Main target (click)</li>
          <li className="flex items-center gap-2"><span className="size-1 rounded-full bg-muted-foreground" />Small dots: more copies</li>
          {targets.some((t) => t.offTarget) && <li className="flex items-center gap-2" title="The drug also binds this protein, though it isn't the intended target. This can cause side effects."><span className="size-1.5 rounded-full" style={{ background: "#7c8a86" }} />Off-target (unintended, weaker)</li>}
          {(["up", "down", "block"] as const).map((d) => (
            <li key={d} className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: DIRECTION_TINT[d] }} />
              <span className="font-medium text-foreground">{DIRECTION_ARROW[d]}</span>
              {DIRECTION_LABEL[d]}
            </li>
          ))}
        </ul>
      )}
      <div className={`absolute bottom-4 right-4 z-10 w-44 p-3 ${view === "cell" ? "" : "hidden"}`}>
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
      <p className={`pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 text-center max-w-[calc(100%-26rem)] text-[9px] leading-relaxed text-muted-foreground ${view === "cell" ? "" : "hidden"}`}>Drag cell to squish<br />Drag background to orbit · Shift-drag to pan · Scroll or W/S to zoom · A/D/Q/E to move · Esc to reset</p>
    </div>
  );
}
