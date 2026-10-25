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
    <section className="relative h-[65vh] overflow-hidden rounded-xl border bg-card lg:h-auto">
      <CellScene />

      {result && view === "cell" && (
        <>
          <div className="absolute left-12 top-3 max-w-sm" title={result.summary}>
            <div className="text-sm font-medium">{result.drug.name}</div>
            {result.summary && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{result.summary}</p>}
          </div>
          <EffectLegend />
        </>
      )}

      {/* Stays mounted across views so narration keeps playing in the molecule view. */}
      {result && (
        <div className={view === "cell" ? "absolute left-3 top-3" : "hidden"}>
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
