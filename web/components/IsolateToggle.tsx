"use client";

import { useSim } from "@/lib/store";

// Hovering an organelle fades the rest of the cell only while this is on.
export function IsolateToggle() {
  const isolateOnHover = useSim((s) => s.isolateOnHover);
  const setIsolateOnHover = useSim((s) => s.setIsolateOnHover);

  return (
    <label className="flex cursor-pointer items-center gap-2 rounded border bg-card/95 px-2.5 py-2 text-[11px]">
      <input type="checkbox" checked={isolateOnHover} onChange={(e) => setIsolateOnHover(e.target.checked)} className="accent-brand" />
      Isolate on hover
    </label>
  );
}
