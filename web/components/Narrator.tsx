"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Volume2, VolumeX } from "lucide-react";
import { API_URL } from "@/lib/sse";
import { useSim } from "@/lib/store";

const PREF_KEY = "mol-narration";

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "off";
  } catch {
    return true;
  }
}

// Reads the judge's summary aloud (Cartesia) when a verdict lands, and walks the 3D highlight
// through the affected organelles in step with the speech.
export function Narrator() {
  const { result, setHighlight } = useSim();
  const [enabled, setEnabled] = useState(true);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "unavailable">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => setEnabled(readPref()), []);

  function stop() {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setHighlight(null);
    setState((s) => (s === "unavailable" ? s : "idle"));
  }

  async function play() {
    if (!result?.summary) return;
    stop();
    setState("loading");
    try {
      const resp = await fetch(`${API_URL}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: result.summary }),
      });
      if (!resp.ok) throw new Error(`tts ${resp.status}`);
      const url = URL.createObjectURL(await resp.blob());
      urlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;

      // Step through the effects' organelles across the length of the narration.
      const regions = [...new Set(result.effects.map((e) => e.organelle))];
      audio.ontimeupdate = () => {
        if (!audio.duration || regions.length === 0) return;
        const i = Math.min(regions.length - 1, Math.floor((audio.currentTime / audio.duration) * regions.length));
        setHighlight(regions[i]);
      };
      audio.onended = stop;
      await audio.play();
      setState("playing");
    } catch (e) {
      // Autoplay blocked or narration unavailable: leave the button for a manual retry.
      setState((e as Error).message?.startsWith("tts 503") ? "unavailable" : "idle");
      setHighlight(null);
    }
  }

  // Auto-narrate each new verdict when narration is on.
  useEffect(() => {
    if (result && enabled) play();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // One button: stopping turns auto-narration off; playing turns it back on.
  function setPref(on: boolean) {
    setEnabled(on);
    try {
      localStorage.setItem(PREF_KEY, on ? "on" : "off");
    } catch {}
  }

  function onClick() {
    if (state === "playing" || state === "loading") {
      setPref(false);
      stop();
    } else {
      setPref(true);
      play();
    }
  }

  if (!result?.summary || state === "unavailable") return null;

  const Icon = state === "loading" ? Loader2 : state === "playing" || enabled ? Volume2 : VolumeX;
  return (
    <button
      onClick={onClick}
      title={state === "playing" ? "Stop narration" : enabled ? "Play narration" : "Narration is off — click to listen"}
      className={`flex size-7 shrink-0 items-center justify-center rounded-full border bg-card/80 backdrop-blur transition-colors hover:border-brand ${
        state === "playing" ? "border-brand text-brand" : "text-muted-foreground"
      }`}
    >
      <Icon className={`size-3.5 ${state === "loading" ? "animate-spin" : ""}`} />
    </button>
  );
}
