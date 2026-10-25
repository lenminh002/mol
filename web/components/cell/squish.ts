import * as THREE from "three";

const FALLOFF = 1.6; // world units; the dent spreads over roughly half the cell
const STIFFNESS = 140;
const DAMPING = 15; // ζ ≈ 0.63: settles quickly with one soft overshoot, like viscous cytoplasm

// One mutable drag shared by every patched material and CPU-side anchor.
export interface SquishState {
  grab: THREE.Vector3;
  offset: THREE.Vector3;
  velocity: THREE.Vector3;
  dragging: boolean;
  uniforms: {
    uGrab: { value: THREE.Vector3 };
    uOffset: { value: THREE.Vector3 };
    uFalloff: { value: number };
  };
}

export function createSquishState(): SquishState {
  const grab = new THREE.Vector3();
  const offset = new THREE.Vector3();
  return {
    grab,
    offset,
    velocity: new THREE.Vector3(),
    dragging: false,
    uniforms: { uGrab: { value: grab }, uOffset: { value: offset }, uFalloff: { value: FALLOFF } },
  };
}

// Released drags spring back to rest; held drags are driven directly by the pointer.
export function stepSquish(state: SquishState, dt: number) {
  if (state.dragging) return;
  const step = Math.min(dt, 1 / 30);
  state.velocity.addScaledVector(state.offset, -STIFFNESS * step).multiplyScalar(Math.max(0, 1 - DAMPING * step));
  state.offset.addScaledVector(state.velocity, step);
  if (state.offset.lengthSq() < 1e-8 && state.velocity.lengthSq() < 1e-6) {
    state.offset.setScalar(0);
    state.velocity.setScalar(0);
  }
}

// CPU twin of the vertex shader, for pins, labels and paths that ride the deformation.
// `out` may alias `point`.
export function deformPoint(point: THREE.Vector3, state: SquishState, strength = 0.18, falloffScale = 1.8, out = new THREE.Vector3()) {
  const falloff = FALLOFF * falloffScale;
  const weight = Math.exp(-point.distanceToSquared(state.grab) / (falloff * falloff)) * strength;
  return out.copy(point).addScaledVector(state.offset, weight);
}

export interface CellMaterialPatch {
  strength?: number; // 1 for the membrane; interior anatomy lags behind it
  falloffScale?: number;
  fresnel?: { min: number; max: number; power: number }; // clear face-on, opaque at grazing angles
  reveal?: { near: number; far: number; alpha: number }; // camera distance where the alpha eases toward `alpha`
  detail?: boolean; // hidden far away, fully drawn up close
  instanceReveal?: boolean; // measure reveal distance per instance rather than per mesh
}

// Adds squish deformation, view-dependent fresnel alpha, and zoom reveal to a built-in material.
export function patchCellMaterial(material: THREE.Material, state: SquishState, patch: CellMaterialPatch = {}) {
  const { strength = 0.18, falloffScale = 1.8, fresnel, reveal, detail = false, instanceReveal = false } = patch;
  if (fresnel || reveal) {
    material.transparent = true;
    if (fresnel) material.depthWrite = false;
  }

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, state.uniforms, {
      uStrength: { value: strength },
      uFalloffScale: { value: falloffScale },
      uFresnel: { value: new THREE.Vector3(fresnel?.min ?? 1, fresnel?.max ?? 1, fresnel?.power ?? 1) },
      uReveal: { value: new THREE.Vector3(reveal?.near ?? 0, reveal?.far ?? 1, reveal?.alpha ?? 1) },
    });

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
uniform vec3 uGrab;
uniform vec3 uOffset;
uniform float uFalloff;
uniform float uStrength;
uniform float uFalloffScale;
varying float vRevealDistance;`)
      .replace("#include <project_vertex>", `vec4 mvPosition = vec4(transformed, 1.0);
vec4 revealCenter = vec4(0.0, 0.0, 0.0, 1.0);
#ifdef USE_BATCHING
  mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  ${instanceReveal ? "revealCenter = instanceMatrix * revealCenter;" : ""}
#endif
vec4 squishWorld = modelMatrix * mvPosition;
vec3 squishDelta = squishWorld.xyz - uGrab;
float squishReach = uFalloff * uFalloffScale;
squishWorld.xyz += uOffset * uStrength * exp(-dot(squishDelta, squishDelta) / (squishReach * squishReach));
vRevealDistance = distance((modelMatrix * revealCenter).xyz, cameraPosition);
mvPosition = viewMatrix * squishWorld;
gl_Position = projectionMatrix * mvPosition;`);

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform vec3 uFresnel;
uniform vec3 uReveal;
varying float vRevealDistance;`)
      .replace("#include <dithering_fragment>", `${fresnel ? `float facing = abs(dot(normalize(normal), normalize(vViewPosition)));
float cellAlpha = mix(uFresnel.x, uFresnel.y, pow(1.0 - facing, uFresnel.z));` : "float cellAlpha = 1.0;"}
${reveal ? `float revealed = clamp((uReveal.y - vRevealDistance) / max(uReveal.y - uReveal.x, 1e-4), 0.0, 1.0);
${detail ? "cellAlpha *= revealed * uReveal.z;" : "cellAlpha = mix(cellAlpha, uReveal.z, revealed);"}` : ""}
gl_FragColor.a *= cellAlpha;
#include <dithering_fragment>`);
  };
  material.customProgramCacheKey = () => `cell:${fresnel ? 1 : 0}${reveal ? 1 : 0}${detail ? 1 : 0}${instanceReveal ? 1 : 0}`;
  material.needsUpdate = true;
  return material;
}
