import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";

// 0 beyond `far`, 1 within `near`, from the camera's distance to `anchor`.
// Held in a ref and refreshed every frame, so reveals never trigger React renders.
export function useZoomReveal(anchor: THREE.Vector3, near: number, far: number) {
  const reveal = useRef(0);
  useFrame(({ camera }) => {
    const distance = camera.position.distanceTo(anchor);
    reveal.current = Math.min(1, Math.max(0, (far - distance) / (far - near)));
  });
  return reveal;
}
