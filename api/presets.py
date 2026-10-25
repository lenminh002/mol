"""Curated demo scenarios: widely used medicines whose drug-bound crystal structures are public.
Each acts in a different part of the cell, so together they exercise the whole cell view."""

from schemas import Preset

PRESETS: list[Preset] = [
    Preset(
        id="imatinib-bcrabl",
        drug="imatinib",
        target="BCR-ABL",
        pdb_id="1IEP",
        blurb="Kinase inhibitor for chronic myeloid leukemia (cytoplasm)",
    ),
    Preset(
        id="aspirin-cox1",
        drug="aspirin",
        target="COX-1",
        pdb_id="6Y3C",
        blurb="Irreversibly acetylates COX-1, cutting prostaglandin synthesis (ER)",
    ),
    Preset(
        id="atorvastatin-hmgcr",
        drug="atorvastatin",
        target="HMG-CoA reductase",
        pdb_id="1HWK",
        blurb="Statin that blocks the rate-limiting step of cholesterol synthesis (ER)",
    ),
    Preset(
        id="tamoxifen-esr1",
        drug="tamoxifen",
        target="estrogen receptor alpha",
        pdb_id="3ERT",
        blurb="Breast cancer drug that blocks estrogen signalling in the nucleus",
    ),
    Preset(
        id="lisinopril-ace",
        drug="lisinopril",
        target="ACE",
        pdb_id="1O86",
        blurb="Blood-pressure medicine that inhibits angiotensin-converting enzyme (membrane)",
    ),
]

PRESETS_BY_ID = {p.id: p for p in PRESETS}
