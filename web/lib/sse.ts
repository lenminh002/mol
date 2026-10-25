import type { ChatEvent, SimEvent, SimulateRequest, SimulationResult } from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// POST + streamed SSE body (EventSource only supports GET, so we parse the stream ourselves).
async function postSSE<E extends { type: string }>(
  path: string,
  body: unknown,
  onEvent: (e: E) => void,
  onFail: (message: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    onFail(`API error ${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, "");
      const data = raw
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as E);
      } catch {
        // ignore keep-alives / malformed chunks
      }
    }
  }
}

export const streamSimulation = (req: SimulateRequest, onEvent: (e: SimEvent) => void, signal?: AbortSignal) =>
  postSSE<SimEvent>("/simulate", req, onEvent, (message) => onEvent({ type: "error", message }), signal);

export const streamChat = (
  body: { result: SimulationResult; messages: { role: string; content: string }[] },
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
) => postSSE<ChatEvent>("/chat", body, onEvent, (message) => onEvent({ type: "error", message }), signal);
