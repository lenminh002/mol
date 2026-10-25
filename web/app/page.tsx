import { AskBar } from "@/components/AskBar";
import { DrugPanel } from "@/components/DrugPanel";
import { DebatePanel } from "@/components/DebatePanel";
import { Viewport } from "@/components/Viewport";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col gap-3 p-3 sm:p-4 lg:h-screen">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-1 pb-3">
        <div className="flex items-baseline gap-3 pl-8">
          <h1 className="font-heading text-5xl font-normal italic leading-none tracking-tight text-teal-700">Mol</h1>
        </div>      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
        <DrugPanel />
        <Viewport />
        <DebatePanel />
      </div>
      <AskBar />
    </main>
  );
}
