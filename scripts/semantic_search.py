"""Локальный семантический поиск по vault/ и memory/ (без OpenAI).

Использует sentence-transformers (модель paraphrase-multilingual-MiniLM-L12-v2 — мультиязычная,
работает с русским). Эмбеддинги кэшируются в reports/semantic_index.npz.

Идея взята из cognee (recall-операция), но реализована локально без сервера и БД.
Вписывается в трёх-store модель: vault canonical + memory scratch + mulch reflex →
теперь + semantic recall как дополнительный слой когда grep/wikilink не справляются.

Usage:
    python scripts/semantic_search.py --reindex                   # пересобрать индекс
    python scripts/semantic_search.py "as-of дата исполнения"     # запрос
    python scripts/semantic_search.py "trust score ШДЮ" --top 10  # top N

Exit codes: 0 = ok, 1 = no results, 2 = bad args.

Зависимости (минимальные):
    pip install sentence-transformers numpy
    (модель скачается при первом запуске, ~120 MB)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import numpy as np
    from sentence_transformers import SentenceTransformer
except ImportError:
    print("ERROR: pip install sentence-transformers numpy", file=sys.stderr)
    sys.exit(2)

ROOTS = [
    Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory"),
    Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR"),
    Path(r"C:/Users/filat/dash/.claude/plans"),
]
INDEX_PATH = Path(r"C:/Users/filat/dash/reports/semantic_index.npz")
META_PATH = Path(r"C:/Users/filat/dash/reports/semantic_index_meta.json")
MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"

# Папки исключения
SKIP = {"node_modules", ".next", "dist", ".git", "_archive", "archive",
        "70-Chat", "00-Inbox", ".obsidian", "Attachments"}


def chunk_file(path: Path, max_chars: int = 1500) -> list[tuple[str, str]]:
    """Файл → [(chunk_id, chunk_text)]. Чанк ≈ один раздел `## ...` или 1500 символов."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return []
    if not text.strip():
        return []

    # Разрезаем по `## ` заголовкам
    chunks: list[tuple[str, str]] = []
    current_title = path.stem
    current_buf: list[str] = []

    def flush():
        if current_buf:
            buf = "\n".join(current_buf).strip()
            if len(buf) >= 30:  # игнорируем мусорные чанки
                # Если чанк большой — режем
                while len(buf) > max_chars:
                    chunks.append((f"{path.name}#{current_title}", buf[:max_chars]))
                    buf = buf[max_chars:]
                chunks.append((f"{path.name}#{current_title}", buf))

    for line in text.split("\n"):
        if line.startswith("## ") and len(line) > 3:
            flush()
            current_title = line[3:].strip()[:80]
            current_buf = []
        else:
            current_buf.append(line)
    flush()
    return chunks


def collect_files() -> list[Path]:
    """Собираем все .md в трёх корнях, исключая SKIP."""
    files: list[Path] = []
    for root in ROOTS:
        if not root.exists():
            continue
        for p in root.rglob("*.md"):
            # Skip if any path component is in SKIP
            if any(part in SKIP for part in p.parts):
                continue
            files.append(p)
    return files


def reindex():
    print(f"[reindex] loading model {MODEL_NAME}...")
    model = SentenceTransformer(MODEL_NAME)
    files = collect_files()
    print(f"[reindex] collected {len(files)} files from {len(ROOTS)} roots")

    all_chunks: list[tuple[str, str, str]] = []  # (path, chunk_id, text)
    for f in files:
        for cid, ctext in chunk_file(f):
            all_chunks.append((str(f), cid, ctext))

    print(f"[reindex] total chunks: {len(all_chunks)}")
    if not all_chunks:
        print("[reindex] no chunks, abort", file=sys.stderr)
        sys.exit(1)

    texts = [c[2] for c in all_chunks]
    print(f"[reindex] embedding... (this may take 1-3 minutes on first run)")
    embeddings = model.encode(texts, show_progress_bar=True, convert_to_numpy=True,
                              normalize_embeddings=True)

    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(INDEX_PATH, embeddings=embeddings)
    META_PATH.write_text(json.dumps([
        {"path": p, "chunk_id": cid, "preview": text[:300]}
        for (p, cid, text) in all_chunks
    ], ensure_ascii=False), encoding="utf-8")

    size_mb = INDEX_PATH.stat().st_size / 1024 / 1024
    print(f"[reindex] wrote {INDEX_PATH} ({size_mb:.1f} MB) + {META_PATH}")
    print(f"[reindex] {len(all_chunks)} chunks indexed across {len(files)} files")


def search(query: str, top_k: int = 5):
    if not INDEX_PATH.exists():
        print(f"ERROR: index not found at {INDEX_PATH}. Run --reindex first.", file=sys.stderr)
        sys.exit(2)

    print(f"[search] loading model + index...")
    model = SentenceTransformer(MODEL_NAME)
    npz = np.load(INDEX_PATH)
    embeddings = npz["embeddings"]
    meta = json.loads(META_PATH.read_text(encoding="utf-8"))

    if len(meta) != len(embeddings):
        print(f"ERROR: meta/index mismatch ({len(meta)} vs {len(embeddings)}). Re-run --reindex.", file=sys.stderr)
        sys.exit(2)

    q_emb = model.encode([query], convert_to_numpy=True, normalize_embeddings=True)[0]
    # cosine similarity = dot product (already normalized)
    scores = embeddings @ q_emb
    top_idx = np.argsort(-scores)[:top_k]

    print(f"\n[search] query: «{query}»")
    print(f"[search] top {top_k} results:\n")
    for rank, idx in enumerate(top_idx, 1):
        m = meta[idx]
        score = float(scores[idx])
        print(f"  {rank}. [{score:.3f}]  {m['chunk_id']}")
        print(f"      path: {m['path']}")
        print(f"      preview: {m['preview'][:200].replace(chr(10), ' ')}")
        print()


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("query", nargs="?", help="search query (RU/EN)")
    p.add_argument("--reindex", action="store_true", help="rebuild semantic index")
    p.add_argument("--top", type=int, default=5, help="top K results (default 5)")
    args = p.parse_args()

    if args.reindex:
        reindex()
        return
    if not args.query:
        p.print_help()
        sys.exit(2)
    search(args.query, args.top)


if __name__ == "__main__":
    main()
