import { DrugPanel } from "@/components/DrugPanel";
import { DebatePanel } from "@/components/DebatePanel";
import { Viewport } from "@/components/Viewport";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col gap-3 p-3 lg:h-screen">
      <header className="flex items-baseline justify-between px-1">
        <h1 className="text-lg font-semibold tracking-tight">
          Mol <span className="font-normal text-muted-foreground">· drug–cell simulator</span>
        </h1>
        <p className="text-xs text-muted-foreground">Research prototype — not medical advice</p>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[300px_1fr_380px]">
        <DrugPanel />
        <Viewport />
        <DebatePanel />
      </div>
    </main>
  );
}
