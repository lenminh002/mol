# Demo video script (about 2:45)

Record at 1440×900 or larger. Click once anywhere first so narration can autoplay.

| Time | On screen | Say |
|---|---|---|
| 0:00 | Landing page | "Understanding what a drug does inside a cell means reading dozens of papers and picturing 3D structures in your head. AI can summarise that, but it also makes things up. Mol makes AI agents *argue* about a drug, with real evidence, and shows the verdict in 3D." |
| 0:15 | Click **imatinib → BCR-ABL** | "This is imatinib, a leukaemia drug. A Claude pharmacologist gathers evidence from PubChem, UniProt, a PubMed index in Elastic and a biomedical knowledge graph…" |
| 0:30 | Debate streaming in the right panel | "…then a reviewer from a different model family, Gemini, challenges the case, and the pharmacologist has to defend or concede." |
| 0:45 | Verdict lands; narration plays; organelles light up | (Let the narration play for about 8 seconds.) "The judge rules on every effect: agreed, disputed or speculative. Here it caught that the STAT5 evidence came from a *different* drug, so it's marked disputed and the nucleus flickers." |
| 1:05 | Hover the reasoning path nodes | "Every step in the reasoning is cited. The first hops come from the knowledge graph, the rest from papers. Click any citation and it opens the source." |
| 1:20 | Click the **BCR-ABL** hotspot → molecule view | "Clicking the target zooms into the real crystal structure. That's imatinib in yellow, in the kinase pocket, with the residues it touches. Thr315 is where the classic resistance mutation sits." |
| 1:40 | Back to cell; type "How does Lipitor lower cholesterol in liver cells?" → Simulate | "You can also just ask. It understood Lipitor as atorvastatin…" |
| 1:55 | Show the saved **atorvastatin** result (cut from the live run) | "…and traced it from the ER enzyme, through less cholesterol, to more LDL receptors on the cell surface. That's how statins clear cholesterol from the blood." |
| 2:15 | Caveats panel | "And it's honest about its limits: in vitro evidence, liver-specific effects, and docking that's only an estimate." |
| 2:30 | Architecture slide (docs/EXECUTION_PLAN.md diagram) | "Claude and Gemini debate over an Elastic hybrid index, a Hetionet knowledge graph and live biology databases, with React Three Fiber and Mol* for the 3D, and Cartesia for the voice. Mol: drug mechanisms you can see, and trust." |

**Backup:** if a live run is slow, every preset replays from its saved debate instantly.
