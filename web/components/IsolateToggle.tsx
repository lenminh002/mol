"use client";

import { useSim } from "@/lib/store";

// Hovering an organelle fades the rest of the cell only while this is on.
export function IsolateToggle() {
  const isolateOnHover = useSim((s) => s.isolateOnHover);
  const setIsolateOnHover = useSim((s) => s.setIsolateOnHover);

  const showLabels = useSim((s) => s.showLabels);
  const setShowLabels = useSim((s) => s.setShowLabels);

  return (
    <div className="flex gap-2">
    <label className="flex flex-1 cursor-pointer items-center whitespace-nowrap gap-2 px-2.5 py-2 text-[11px]">
      <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} className="accent-brand" />
      Show labels
    </label>
    <label className="flex flex-1 cursor-pointer items-center whitespace-nowrap gap-2 px-2.5 py-2 text-[11px]">
      <input type="checkbox" checked={isolateOnHover} onChange={(e) => setIsolateOnHover(e.target.checked)} className="accent-brand" />
      Isolate on hover
    </label>
    </div>
  );
}
