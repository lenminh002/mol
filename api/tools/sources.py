"""Literature and web sources for the knowledge base. Every document comes back in one shape:

    {"source_id", "source", "title", "text", "url", "year", "pmid"}

- PubMed: NCBI "Best Match" ranking picks papers; Europe PMC supplies the abstracts (no key needed).
- ClinicalTrials.gov API v2 (no key needed).
- Bright Data (optional, needs BRIGHTDATA_API_KEY + zones): SERP search + Web Unlocker page fetch for
  pages such as drug labels and agency summaries that have no API.
"""

import html
import json
import os
import re
from urllib.parse import quote_plus

import httpx

ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
EUROPE_PMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
CTGOV = "https://clinicaltrials.gov/api/v2/studies"
BRIGHTDATA = "https://api.brightdata.com/request"


def pubmed(query: str, k: int = 5) -> list[dict]:
    ids = httpx.get(
        ESEARCH,
        params={"db": "pubmed", "term": f"{query} AND hasabstract", "retmax": k, "retmode": "json",
                "sort": "relevance"},
        timeout=30,
    )
    ids.raise_for_status()
    pmids: list[str] = ids.json()["esearchresult"]["idlist"]
    if not pmids:
        return []
    resp = httpx.get(
        EUROPE_PMC,
        params={"query": "(" + " OR ".join(f"EXT_ID:{p}" for p in pmids) + ") AND SRC:MED",
                "format": "json", "resultType": "core", "pageSize": len(pmids)},
        timeout=30,
    )
    resp.raise_for_status()
    by_pmid = {r.get("pmid"): r for r in resp.json().get("resultList", {}).get("result", [])}
    docs = []
    for pmid in pmids:  # keep PubMed's relevance order
        if not (r := by_pmid.get(pmid)):
            continue
        abstract = (r.get("abstractText") or "").replace("<h4>", " ").replace("</h4>", ": ")
        docs.append({
            "source_id": f"pmid:{pmid}",
            "source": "pubmed",
            "title": r.get("title", "").rstrip("."),
            "text": re.sub(r"<[^>]+>", "", abstract)[:3000],
            "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
            "year": r.get("pubYear"),
            "pmid": pmid,
        })
    return docs


def clinical_trials(intervention: str, k: int = 10) -> list[dict]:
    resp = httpx.get(
        CTGOV,
        params={"query.intr": intervention, "pageSize": k,
                "fields": "NCTId,BriefTitle,BriefSummary,OverallStatus,Phase,StartDate,Condition"},
        timeout=30,
    )
    resp.raise_for_status()
    docs = []
    for s in resp.json().get("studies", []):
        p = s["protocolSection"]
        nct = p["identificationModule"]["nctId"]
        conditions = ", ".join(p.get("conditionsModule", {}).get("conditions", [])[:4])
        status = p.get("statusModule", {})
        phases = ", ".join(p.get("designModule", {}).get("phases", []))
        summary = p.get("descriptionModule", {}).get("briefSummary", "")
        docs.append({
            "source_id": f"nct:{nct}",
            "source": "clinicaltrials",
            "title": p["identificationModule"]["briefTitle"],
            "text": f"Status: {status.get('overallStatus', '?')}. Phase: {phases or 'n/a'}. "
                    f"Conditions: {conditions}. {summary}"[:3000],
            "url": f"https://clinicaltrials.gov/study/{nct}",
            "year": (status.get("startDateStruct", {}).get("date") or "")[:4] or None,
            "pmid": None,
        })
    return docs


# --- Bright Data (optional) ------------------------------------------------------------------


def brightdata_enabled() -> bool:
    return bool(os.getenv("BRIGHTDATA_API_KEY") and os.getenv("BRIGHTDATA_UNLOCKER_ZONE"))


def _brightdata(url: str, zone: str) -> str:
    resp = httpx.post(
        BRIGHTDATA,
        headers={"Authorization": f"Bearer {os.environ['BRIGHTDATA_API_KEY']}"},
        json={"zone": zone, "url": url, "format": "raw"},
        timeout=90,
    )
    resp.raise_for_status()
    return resp.text


def web_search(query: str, k: int = 5) -> list[dict]:
    """Google results via Bright Data's SERP API (parsed JSON with brd_json=1)."""
    zone = os.getenv("BRIGHTDATA_SERP_ZONE")
    if not zone:
        return []
    raw = _brightdata(f"https://www.google.com/search?q={quote_plus(query)}&brd_json=1", zone)
    organic = json.loads(raw).get("organic", [])
    return [{"title": r.get("title", ""), "url": r["link"]} for r in organic[:k] if r.get("link")]


def _html_to_text(page: str) -> str:
    page = re.sub(r"(?is)<(script|style|nav|footer|header)[^>]*>.*?</\1>", " ", page)
    text = html.unescape(re.sub(r"(?s)<[^>]+>", " ", page))
    return re.sub(r"\s+", " ", text).strip()


def web_page(url: str, title: str = "", max_chars: int = 9000) -> list[dict]:
    """Fetch a page through Bright Data's Web Unlocker and split it into ~1.5k-char chunks."""
    text = _html_to_text(_brightdata(url, os.environ["BRIGHTDATA_UNLOCKER_ZONE"]))[:max_chars]
    chunks = [text[i : i + 1500] for i in range(0, len(text), 1500)]
    return [
        {"source_id": f"web:{url}", "source": "web", "title": title or url, "text": c, "url": url,
         "year": None, "pmid": None, "chunk": n}
        for n, c in enumerate(chunks)
        if len(c) > 200
    ]
