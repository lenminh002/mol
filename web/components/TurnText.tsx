"use client";

import ReactMarkdown from "react-markdown";
import type { Citation } from "@/lib/types";

const SOURCE_ID = /^(?:pmid|nct|pubchem|pdb|dock|uniprot|web|hetionet|curated):\S+$/;

// Agents cite inline as [pmid:123] or grouped [pdb:1IEP; pmid:456]. Turn each known id into a
// markdown link so it renders as a clickable chip; unknown ids stay as plain text.
function linkCitations(text: string, citations: Map<string, Citation>): string {
  return text.replace(/\[([^\]]+)\](?!\()/g, (whole, group: string) => {
    const parts = group.split(/[;,]\s*/).map((p) => p.trim());
    if (!parts.every((p) => SOURCE_ID.test(p))) return whole;
    return parts
      .map((id) => {
        const c = citations.get(id);
        return c?.url ? `[${c.pmid ? `PMID ${c.pmid}` : id}](${c.url} "${c.title.replace(/"/g, "'")}")` : `\`${id}\``;
      })
      .join(" ");
  });
}

export function TurnText({ text, citations }: { text: string; citations: Map<string, Citation> }) {
  return (
    <div className="text-sm leading-relaxed text-foreground [&_li]:ml-4 [&_li]:list-disc [&_ol>li]:list-decimal [&_p]:my-1.5 [&_strong]:font-semibold">
      <ReactMarkdown
        components={{
          a: ({ href, title, children }) => (
            <a
              href={href}
              title={title}
              target="_blank"
              rel="noreferrer"
              className="mx-0.5 rounded border px-1 py-px align-baseline text-[10px] text-muted-foreground no-underline hover:border-brand hover:text-brand"
            >
              {children}
            </a>
          ),
          code: ({ children }) => (
            <span className="mx-0.5 rounded border px-1 py-px text-[10px] text-muted-foreground">{children}</span>
          ),
        }}
      >
        {linkCitations(text, citations)}
      </ReactMarkdown>
    </div>
  );
}
