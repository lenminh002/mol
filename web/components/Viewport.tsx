"use client";

import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { useSim } from "@/lib/store";
import { EffectLegend } from "./EffectLegend";
import { Narrator } from "./Narrator";

const CellScene = dynamic(() => import("./cell/CellScene").then((m) => m.CellScene), { ssr: false });
const MoleculePanel = dynamic(() => import("./molecule/MoleculePanel").then((m) => m.MoleculePanel), {
  ssr: false,
});

// Center 3D area: the cell view, and the molecule view after a target hotspot is clicked.
export function Viewport() {
  const { view, result } = useSim();

  return (
    <section className="relative h-[70svh] min-h-[480px] min-w-0 overflow-hidden rounded-md bg-background lg:h-auto lg:min-h-0">
      <CellScene />

      {result && view === "cell" && (
        <>
          <div className="pointer-events-none absolute left-14 right-4 top-[6.5rem] z-10 max-w-sm rounded-md border bg-card/95 px-3 py-2" title={result.summary}>
            <div className="text-sm font-medium">{result.drug.name}</div>
            {result.summary && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{result.summary}</p>}
          </div>
          <EffectLegend />
        </>
      )}

      {/* Stays mounted across views so narration keeps playing in the molecule view. */}
      {result && (
        <div className={view === "cell" ? "absolute left-4 top-[6.5rem] z-10" : "hidden"}>
          <Narrator />
        </div>
      )}

      <AnimatePresence>
        {view === "molecule" && (
          <motion.div
            key="molecule"
            className="absolute inset-0"
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
          >
            <MoleculePanel />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
