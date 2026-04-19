"""Build one Obsidian atom per significant symbol in the AEMR monorepo."""
import os
import re
from pathlib import Path
from datetime import date

ROOT = Path(r"C:\Users\filat\dash")
PKG = ROOT / "packages"
OUT = Path(r"C:\Users\filat\Documents\Obsidian\delete not delete\AEMR\80-Code")
TODAY = "2026-04-15"

# Source groups: (out_subfolder, source_glob, atom_type, slice_tag)
GROUPS = [
    ("components", ["web/src/components/**/*.tsx", "web/src/pages/*.tsx"], "component", "ui"),
    ("hooks",      ["web/src/hooks/*.ts"],                                  "hook",      "ui"),
    ("routes",     ["server/src/routes/*.ts"],                              "route",     "api"),
    ("services",   ["server/src/services/*.ts"],                            "service",   "api"),
    ("pipeline",   ["core/src/pipeline/*.ts"],                              "pipeline",  "pipeline"),
]

SKIP_NAMES = {"index.ts", "index.tsx"}
EXPORT_RE = re.compile(
    r"^export\s+(?:default\s+)?(?:async\s+)?"
    r"(?:function|const|class|interface|type|enum)\s+([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)
DEFAULT_EXPORT_RE = re.compile(r"^export\s+default\s+(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)", re.MULTILINE)
IMPORT_RE = re.compile(r'^import\s+[^;]+from\s+[\'\"]([^\'\"]+)[\'\"]', re.MULTILINE)
JSDOC_RE = re.compile(r"/\*\*\s*\n((?:\s*\*[^\n]*\n)+)\s*\*/", re.MULTILINE)


def first_purpose(text: str) -> str:
    """Return one-line purpose from first JSDoc or a top comment."""
    m = JSDOC_RE.search(text[:1500])
    if m:
        lines = [l.strip().lstrip("*").strip() for l in m.group(1).splitlines()]
        lines = [l for l in lines if l and not l.startswith("@")]
        if lines:
            return lines[0][:180]
    for line in text.splitlines()[:25]:
        ls = line.strip()
        if ls.startswith("//") and len(ls) > 4:
            return ls.lstrip("/ ").strip()[:180]
    return ""


def extract_signature(text: str, name: str) -> str:
    """Extract up to 10 lines of the main symbol's signature."""
    # Component/function
    patterns = [
        rf"export\s+(?:default\s+)?function\s+{re.escape(name)}\s*\([^)]*\)[^{{]*",
        rf"export\s+(?:default\s+)?const\s+{re.escape(name)}\s*[:=][^;=]*=\s*(?:\([^)]*\)|[A-Za-z_][A-Za-z0-9_]*)\s*=>",
        rf"interface\s+{re.escape(name)}(?:<[^>]*>)?\s*(?:extends[^{{]+)?\{{[^}}]*\}}",
        rf"type\s+{re.escape(name)}(?:<[^>]*>)?\s*=[^;]+;",
        rf"class\s+{re.escape(name)}[^{{]*\{{",
    ]
    for p in patterns:
        m = re.search(p, text, re.MULTILINE | re.DOTALL)
        if m:
            sig = m.group(0)
            lines = sig.splitlines()[:10]
            return "\n".join(lines).rstrip()
    return ""


def top_imports(text: str, limit: int = 8) -> list[str]:
    imps = IMPORT_RE.findall(text)
    # keep first N, prefer non-relative (exclude pure '.')
    out = []
    for i in imps:
        if i not in out:
            out.append(i)
        if len(out) >= limit:
            break
    return out


def count_branches(text: str) -> int:
    # crude: count top-level JSX conditionals & returns
    return len(re.findall(r"\?\s*<|&&\s*<|\{\s*\w+\s*\.\s*map\(|return\s*\(", text))


def infer_exports(text: str) -> list[str]:
    ex = EXPORT_RE.findall(text)
    de = DEFAULT_EXPORT_RE.findall(text)
    seen = []
    for n in de + ex:
        if n not in seen:
            seen.append(n)
    return seen[:6]


def guess_links(name: str, folder: str) -> list[str]:
    links = []
    # simple heuristics
    mapping = {
        "Dashboard": "80-Code/components/Sidebar",
        "Analytics": "80-Code/pipeline/signals",
        "Economy":   "80-Code/pipeline/calc-engine",
        "Quality":   "80-Code/pipeline/signals",
        "Trust":     "80-Code/pipeline/signals",
        "Recon":     "80-Code/pipeline/reconcile",
        "Recs":      "80-Code/pipeline/recommendations",
        "Issues":    "80-Code/routes/issues",
        "Journal":   "80-Code/routes/journal",
        "Settings":  "80-Code/routes/settings",
        "DataBrowser": "80-Code/routes/rows",
    }
    if name in mapping:
        links.append(f"[[{mapping[name]}]]")
    return links


def yaml_list(items: list[str]) -> str:
    if not items:
        return "[]"
    return "[" + ", ".join(f'"{i}"' for i in items) + "]"


def write_atom(out_dir: Path, name: str, atom_type: str, slice_tag: str,
               rel_file: str, purpose: str, signature: str,
               imports: list[str], loc: int, branches: int,
               exports: list[str], extra_related: list[str] | None = None):
    out_dir.mkdir(parents=True, exist_ok=True)
    related = extra_related or []
    related += guess_links(name, out_dir.name)
    fm = (
        "---\n"
        f"type: {atom_type}\n"
        f'tags: ["#слой/{slice_tag}", "#проект/аемр"]\n'
        f"created: {TODAY}\n"
        f"updated: {TODAY}\n"
        "status: active\n"
        f'file: "{rel_file}"\n'
        f"exports: {yaml_list(exports)}\n"
        "uses: []\n"
        "used_by: []\n"
        f"related: {yaml_list([])}\n"
        "---\n\n"
    )
    body = [f"# {name}\n"]
    if purpose:
        body.append(f"> [!info] {purpose}\n")
    else:
        body.append(f"> [!info] {atom_type.capitalize()} из `{rel_file}`.\n")
    if signature:
        body.append("## Сигнатура\n```ts\n" + signature + "\n```\n")
    if imports:
        body.append("## Зависимости (импорты верхнего уровня)\n" +
                    "\n".join(f"- `{i}`" for i in imports[:8]) + "\n")
    body.append(
        f"## Локальная сложность\n"
        f"{loc} LOC, ~{branches} JSX/return веток, "
        f"{len(exports)} экспорт(а/ов).\n"
    )
    if related:
        body.append("## Связи\n" + "\n".join(f"- {r}" for r in related) + "\n")

    path = out_dir / f"{name}.md"
    path.write_text(fm + "\n".join(body), encoding="utf-8")


def process_file(src: Path, out_sub: str, atom_type: str, slice_tag: str) -> tuple[str, int]:
    if src.name in SKIP_NAMES:
        return None, 0
    if ".test." in src.name:
        return None, 0
    text = src.read_text(encoding="utf-8", errors="ignore")
    loc = text.count("\n") + 1
    if loc < 30 and atom_type in {"hook", "service"}:
        # allow small components; skip micro utilities
        return None, loc
    exports = infer_exports(text)
    if not exports:
        return None, loc
    name = src.stem
    # For pages folder, keep file stem
    purpose = first_purpose(text)
    signature = extract_signature(text, exports[0])
    imports = top_imports(text)
    branches = count_branches(text)
    rel = src.relative_to(ROOT).as_posix()
    out_dir = OUT / out_sub
    write_atom(out_dir, name, atom_type, slice_tag, rel,
               purpose, signature, imports, loc, branches, exports)
    return name, loc


def build_types():
    """Atomize top ~18 key types from shared/src/types.ts and schemas.ts."""
    src_files = [PKG / "shared/src/types.ts", PKG / "shared/src/schemas.ts"]
    # Key types: based on recurring/important names
    priority = [
        "StageRow", "StageStatus", "StageKey",
        "ShdyuRow", "SvodRow", "MetricValue",
        "Signal", "SignalSeverity", "Issue",
        "TrustScore", "Recommendation", "ReconResult",
        "AuditEntry", "Snapshot", "DatasetSignals",
        "ComputedRow", "OrgNode", "RuleHit",
        "MetricId", "Persona", "FilterState",
    ]
    results = []
    for sf in src_files:
        text = sf.read_text(encoding="utf-8", errors="ignore")
        for name in priority:
            pat = re.compile(
                rf"export\s+(?:interface|type|enum)\s+{re.escape(name)}\b[^=\{{]*(?:=[^;]+;|\{{(?:[^{{}}]|\{{[^{{}}]*\}})*\}})",
                re.MULTILINE | re.DOTALL,
            )
            m = pat.search(text)
            if not m:
                continue
            sig = m.group(0)
            sig_lines = sig.splitlines()
            if len(sig_lines) > 20:
                sig = "\n".join(sig_lines[:20]) + "\n  // ..."
            rel = sf.relative_to(ROOT).as_posix()
            write_atom(
                OUT / "types", name, "type", "shared", rel,
                purpose=f"Общий тип пакета shared: {name}.",
                signature=sig,
                imports=[], loc=len(sig_lines), branches=0,
                exports=[name],
            )
            results.append((name, len(sig_lines)))
    return results


def build_metrics():
    src = PKG / "core/src/metrics/registry.ts"
    text = src.read_text(encoding="utf-8", errors="ignore")
    rel = src.relative_to(ROOT).as_posix()
    # Try to find STANDARD_METRICS: Record<...>= { id: {...}, ... }
    m = re.search(r"STANDARD_METRICS[^=]*=\s*(\{[\s\S]+?\n\})\s*(?:as\s+const)?\s*;", text)
    metric_names = []
    if m:
        body = m.group(1)
        # entries: look for `key: {` or `'key': {`
        for em in re.finditer(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{", body, re.MULTILINE):
            metric_names.append(em.group(1))
    metric_names = [n for n in metric_names if n not in {"id", "label", "unit", "description", "formula", "tier"}]
    metric_names = list(dict.fromkeys(metric_names))[:25]
    if metric_names:
        for name in metric_names:
            # extract short block for that key
            em = re.search(
                rf"^\s*{re.escape(name)}\s*:\s*\{{([\s\S]*?)\n\s*\}}\s*,?",
                text, re.MULTILINE,
            )
            sig = ""
            if em:
                block = em.group(0)
                lines = block.splitlines()[:12]
                sig = "\n".join(lines).rstrip()
            write_atom(
                OUT / "metrics", name, "metric", "calc-engine", rel,
                purpose=f"Запись реестра метрик: {name}.",
                signature=sig,
                imports=[], loc=len(sig.splitlines()) if sig else 0, branches=0,
                exports=[name],
            )
        return metric_names
    # Fallback: single atom
    write_atom(
        OUT / "metrics", "registry", "metric", "calc-engine", rel,
        purpose="Реестр стандартных метрик (STANDARD_METRICS).",
        signature="", imports=top_imports(text), loc=text.count("\n") + 1,
        branches=0, exports=infer_exports(text),
    )
    return ["registry"]


def main():
    counts = {}
    sizes = []  # (loc, name, folder)
    for out_sub, globs, atom_type, slice_tag in GROUPS:
        counts[out_sub] = 0
        for g in globs:
            for src in PKG.glob(g):
                if not src.is_file():
                    continue
                name, loc = process_file(src, out_sub, atom_type, slice_tag)
                if name:
                    counts[out_sub] += 1
                    sizes.append((loc, name, out_sub))
    # types & metrics
    t = build_types()
    counts["types"] = len(t)
    for n, loc in t:
        sizes.append((loc, n, "types"))
    ms = build_metrics()
    counts["metrics"] = len(ms)

    print("Counts per folder:")
    for k, v in counts.items():
        print(f"  {k}: {v}")
    print(f"Total atoms: {sum(counts.values())}")
    sizes.sort(reverse=True)
    print("\nTop 10 largest by LOC:")
    for loc, name, folder in sizes[:10]:
        print(f"  {loc:5d}  {folder}/{name}")


if __name__ == "__main__":
    main()
