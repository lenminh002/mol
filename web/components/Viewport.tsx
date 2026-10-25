"use client";

import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { useSim } from "@/lib/store";
import { EffectTimeline } from "./EffectTimeline";
import { IsolateToggle } from "./IsolateToggle";
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

      {view === "cell" && (
        <div className="absolute right-4 top-4 z-10 flex w-[min(18rem,calc(100%-2rem))] flex-col gap-2">
          {result && <EffectTimeline />}
          <IsolateToggle />
        </div>
      )}

      {/* Stays mounted across views so narration keeps playing in the molecule view. */}
      {result && (
        <div
          className={view === "cell" ? "pointer-events-none absolute left-4 right-4 top-[9.25rem] z-10 max-w-sm py-2" : "hidden"}
          title={result.summary}
        >
          <div className="flex min-h-8 items-center gap-2 text-sm font-medium">
            {result.drug.name}
            <div className="pointer-events-auto">
              <Narrator />
            </div>
          </div>
          {result.summary && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{result.summary}</p>}
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
