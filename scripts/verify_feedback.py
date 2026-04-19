"""Verify feedback/persona/concept atoms against original user messages in JSONL chat log.

Output: JSON report with {atom, keywords, user_quotes, first_timestamp, last_timestamp}.
"""
from __future__ import annotations
import json
import re
from pathlib import Path
from collections import defaultdict

JSONL = Path(r"C:\Users\filat\.claude\projects\C--Users-filat-dash\725bfdb8-55f0-45ec-a166-df2c4a389210.jsonl")
VAULT = Path(r"C:\Users\filat\Documents\Obsidian\delete not delete\AEMR\20-Knowledge")
OUT = Path(r"C:\Users\filat\dash\scripts\verify_feedback_raw.json")

# --- Step 1: extract all USER messages (external user, not tool_result) with timestamps ---
def load_user_messages():
    msgs = []
    with JSONL.open("r", encoding="utf-8") as f:
        for line in f:
            try:
                rec = json.loads(line)
            except Exception:
                continue
            if rec.get("type") != "user":
                continue
            # skip tool_result-only and sidechain messages
            if rec.get("isSidechain"):
                continue
            msg = rec.get("message", {})
            content = msg.get("content")
            text = ""
            if isinstance(content, str):
                text = content
            elif isinstance(content, list):
                parts = []
                for p in content:
                    if isinstance(p, dict) and p.get("type") == "text":
                        parts.append(p.get("text", ""))
                    elif isinstance(p, dict) and p.get("type") == "tool_result":
                        # skip tool results — not the user's own words
                        pass
                text = "\n".join(parts)
            if not text.strip():
                continue
            # Only keep messages that look like human input (not tool results / system)
            # External entrypoint + userType external
            if rec.get("userType") != "external":
                continue
            ts = rec.get("timestamp", "")
            msgs.append({"ts": ts, "text": text})
    return msgs

print("Loading user messages...")
USER_MSGS = load_user_messages()
print(f"Got {len(USER_MSGS)} user messages")

# --- Step 2: define search queries per atom (distinctive keywords/phrases) ---
QUERIES = {
    "user-screen-resolution": [
        "1240", "480", "экран", "разрешение", "скриншот", "preview"
    ],
    "personas-12-verified": [
        "12 персон", "25 персон", "массовый опрос", "персоны", "Наталья", "Алексей", "Виктор"
    ],
    "user-requirements-recurring": [
        "заплатками", "декларативные", "Apple", "крутилка", "Организация X", "без подведов", "корень проблемы"
    ],
    "feedback-karpathy-methodology": [
        "Карпат", "karpathy", "цикл", "анализ", "синтез", "5 персон", "12 персон"
    ],
    "feedback-kb-tooltip-russian-literary": [
        "литературн", "русском", "tooltip", "KB", "по аналогии", "так и так", "заглушк"
    ],
    "feedback-smart-cards-not-drilldown": [
        "ебать какой умной", "ебать", "умной", "drill", "карточка", "умн", "универсальн", "flat"
    ],
    "entity-map": [
        "карта сущност", "ENTITY_MAP", "актуальной"
    ],
    "feedback-mixer-philosophy": [
        "миксер", "закинули", "замержи", "взяли всё", "total rehaul", "выкинули"
    ],
    "feedback-paradigm-shift": [
        "строка = атом", "атом данных", "орг сама", "_org_itself", "лист организации", "col C", "парадигм"
    ],
    "product-model": [
        "ручные еженедельные", "автоматическ", "12 персон", "раннее предупрежд", "миссия"
    ],
    "report-methodology-paradigm": [
        "программа должна стать лучше чем отчет", "заменить его", "отчет на"
    ],
    "signal-system-ru": [
        "5 групп сигналов", "необходимость и достаточность", "целостность", "аномали"
    ],
    "unified-concept": [
        "лист организации содержит", "единое полотно", "сквозные", "строка = атом"
    ],
}

def search(keyword: str, case_insensitive=True):
    hits = []
    kw = keyword.lower() if case_insensitive else keyword
    for m in USER_MSGS:
        hay = m["text"].lower() if case_insensitive else m["text"]
        if kw in hay:
            # find snippet
            idx = hay.find(kw)
            snip = m["text"][max(0, idx-120): idx+200]
            hits.append({"ts": m["ts"], "snippet": snip.replace("\n", " ")})
    return hits

results = {}
for atom, keywords in QUERIES.items():
    atom_hits = {}
    for kw in keywords:
        h = search(kw)
        if h:
            atom_hits[kw] = h[:5]  # top 5 per keyword
    results[atom] = atom_hits

OUT.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Wrote {OUT}")

# --- Step 3: print a compact summary for quick review ---
for atom, hits in results.items():
    total = sum(len(v) for v in hits.values())
    print(f"\n=== {atom} ({total} hits across {len(hits)} keywords) ===")
    for kw, arr in hits.items():
        if not arr:
            continue
        print(f"  [{kw}] {len(arr)} hits")
        for h in arr[:2]:
            print(f"    {h['ts']}: ...{h['snippet'][:180]}...")
