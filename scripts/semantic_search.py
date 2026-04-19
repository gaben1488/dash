"""Гибридный поиск по vault/ + memory/ + plans/: BM25 × векторы × RRF (k=60).

Inspired by VaultSearch (https://github.com/erayaydn0/obsidian-vault-search) — лучшая
из known реализаций гибридного поиска для Obsidian. RRF (Reciprocal Rank Fusion) —
индустриальный стандарт (Elasticsearch, Weaviate, Qdrant).

**Зачем гибрид**:
- BM25 ловит точные термины («BRAT», «Templater», «file.mtime») — то что vectors мажут.
- Векторы ловят смысл («продуктивность» → находит «GTD», «inbox», «next actions»).
- RRF сливает два ранжирования по позициям (не по scores, которые в разных шкалах
  несравнимы). Заметка на 3-й позиции в BM25 + 5-й в vectors часто выстреливает выше
  чем 1-я в одном методе и отсутствие в другом.

**Модель**: `paraphrase-multilingual-MiniLM-L12-v2` (384 dim, 47 MB,
поддерживает русский) — та же что в VaultSearch.

Usage:
    python scripts/semantic_search.py --reindex                     # rebuild index (~3 min first time)
    python scripts/semantic_search.py "as-of дата исполнения"       # hybrid search
    python scripts/semantic_search.py "BRAT" --bm25-only            # только BM25 (точные термины)
    python scripts/semantic_search.py "запоминание" --vector-only   # только векторы (смысл)
    python scripts/semantic_search.py "trust" --top 10 --rrf-k 60   # настроить RRF

Зависимости:
    pip install sentence-transformers numpy rank-bm25
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    import numpy as np
    from sentence_transformers import SentenceTransformer
    from rank_bm25 import BM25Okapi
except ImportError as e:
    print(f"ERROR: missing dep ({e}). Run: pip install sentence-transformers numpy rank-bm25", file=sys.stderr)
    sys.exit(2)

ROOTS = [
    Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory"),
    Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR"),
    Path(r"C:/Users/filat/dash/.claude/plans"),
]
INDEX_PATH = Path(r"C:/Users/filat/dash/reports/semantic_index.npz")
META_PATH = Path(r"C:/Users/filat/dash/reports/semantic_index_meta.json")
BM25_PATH = Path(r"C:/Users/filat/dash/reports/semantic_index_bm25.json")
MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"

SKIP = {"node_modules", ".next", "dist", ".git", "_archive", "archive",
        "70-Chat", "00-Inbox", ".obsidian", "Attachments"}

# Простой токенизатор для BM25: lowercase + split по non-word + min len 2
_TOKEN_RE = re.compile(r"[\w]+", re.UNICODE)


def tokenize(text: str) -> list[str]:
    """RU/EN токенизация: lowercase, по буквам/цифрам, ≥2 символа."""
    return [t for t in _TOKEN_RE.findall(text.lower()) if len(t) >= 2]


def chunk_file(path: Path, max_chars: int = 1500) -> list[tuple[str, str]]:
    """Файл → [(chunk_id, chunk_text)]. Чанк ≈ один раздел `## ...` или 1500 chars."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return []
    if not text.strip():
        return []
    chunks: list[tuple[str, str]] = []
    current_title = path.stem
    current_buf: list[str] = []

    def flush():
        if current_buf:
            buf = "\n".join(current_buf).strip()
            if len(buf) >= 30:
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
    files: list[Path] = []
    for root in ROOTS:
        if not root.exists():
            continue
        for p in root.rglob("*.md"):
            if any(part in SKIP for part in p.parts):
                continue
            files.append(p)
    return files


def reindex():
    print(f"[reindex] loading model {MODEL_NAME}...")
    model = SentenceTransformer(MODEL_NAME)
    files = collect_files()
    print(f"[reindex] collected {len(files)} files from {len(ROOTS)} roots")

    all_chunks: list[tuple[str, str, str]] = []
    for f in files:
        for cid, ctext in chunk_file(f):
            all_chunks.append((str(f), cid, ctext))

    print(f"[reindex] total chunks: {len(all_chunks)}")
    if not all_chunks:
        print("[reindex] no chunks, abort", file=sys.stderr)
        sys.exit(1)

    texts = [c[2] for c in all_chunks]

    # 1) Vector index
    print(f"[reindex] embedding {len(texts)} chunks (1-3 min on first run)...")
    embeddings = model.encode(texts, show_progress_bar=True, convert_to_numpy=True,
                              normalize_embeddings=True)

    # 2) BM25 index — токенизированный корпус
    print(f"[reindex] tokenizing for BM25...")
    tokenized_corpus = [tokenize(t) for t in texts]

    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(INDEX_PATH, embeddings=embeddings)

    META_PATH.write_text(json.dumps([
        {"path": p, "chunk_id": cid, "preview": text[:300]}
        for (p, cid, text) in all_chunks
    ], ensure_ascii=False), encoding="utf-8")

    # BM25 нельзя сериализовать через json напрямую — сохраняем токенизированный корпус,
    # пересоздаём BM25 при каждом search (быстрее чем pickle для нашего масштаба ≤100k chunks)
    BM25_PATH.write_text(json.dumps([" ".join(t) for t in tokenized_corpus],
                                     ensure_ascii=False), encoding="utf-8")

    size_mb_vec = INDEX_PATH.stat().st_size / 1024 / 1024
    size_mb_bm25 = BM25_PATH.stat().st_size / 1024 / 1024
    print(f"[reindex] wrote vector index ({size_mb_vec:.1f} MB) + BM25 corpus ({size_mb_bm25:.1f} MB)")
    print(f"[reindex] {len(all_chunks)} chunks across {len(files)} files")


def rrf_fuse(bm25_ranks: dict[int, int], vec_ranks: dict[int, int], k: int = 60) -> list[tuple[int, float]]:
    """Reciprocal Rank Fusion: score(d) = Σ 1/(k + rank_i(d)) по retriever'ам.
    Чанки которые не были найдены retriever'ом — не добавляют слагаемое."""
    all_ids = set(bm25_ranks) | set(vec_ranks)
    fused: dict[int, float] = {}
    for cid in all_ids:
        score = 0.0
        if cid in bm25_ranks:
            score += 1.0 / (k + bm25_ranks[cid])
        if cid in vec_ranks:
            score += 1.0 / (k + vec_ranks[cid])
        fused[cid] = score
    return sorted(fused.items(), key=lambda x: -x[1])


def search(query: str, top_k: int = 5, mode: str = "hybrid", rrf_k: int = 60):
    if not INDEX_PATH.exists():
        print(f"ERROR: index not found at {INDEX_PATH}. Run --reindex first.", file=sys.stderr)
        sys.exit(2)

    print(f"[search] loading model + indexes...")
    npz = np.load(INDEX_PATH)
    embeddings = npz["embeddings"]
    meta = json.loads(META_PATH.read_text(encoding="utf-8"))

    if mode in ("hybrid", "bm25"):
        bm25_corpus_strings = json.loads(BM25_PATH.read_text(encoding="utf-8"))
        bm25_corpus = [s.split() for s in bm25_corpus_strings]
        bm25 = BM25Okapi(bm25_corpus)

    if mode in ("hybrid", "vector"):
        model = SentenceTransformer(MODEL_NAME)

    # BM25 ranking
    bm25_ranks: dict[int, int] = {}
    bm25_top_n = max(top_k * 5, 30)  # берём top 5×k для slияния
    if mode in ("hybrid", "bm25"):
        bm25_scores = bm25.get_scores(tokenize(query))
        bm25_top = np.argsort(-bm25_scores)[:bm25_top_n]
        bm25_ranks = {int(idx): rank + 1 for rank, idx in enumerate(bm25_top) if bm25_scores[idx] > 0}

    # Vector ranking
    vec_ranks: dict[int, int] = {}
    if mode in ("hybrid", "vector"):
        q_emb = model.encode([query], convert_to_numpy=True, normalize_embeddings=True)[0]
        vec_scores = embeddings @ q_emb
        vec_top = np.argsort(-vec_scores)[:bm25_top_n]
        vec_ranks = {int(idx): rank + 1 for rank, idx in enumerate(vec_top)}

    # Fusion
    if mode == "hybrid":
        fused = rrf_fuse(bm25_ranks, vec_ranks, k=rrf_k)
    elif mode == "bm25":
        fused = [(cid, 1.0 / (rrf_k + r)) for cid, r in sorted(bm25_ranks.items(), key=lambda x: x[1])]
    elif mode == "vector":
        fused = [(cid, 1.0 / (rrf_k + r)) for cid, r in sorted(vec_ranks.items(), key=lambda x: x[1])]

    print(f"\n[search] mode={mode}  query=«{query}»  rrf_k={rrf_k if mode == 'hybrid' else 'n/a'}")
    print(f"[search] top {top_k} results:\n")
    for rank, (idx, score) in enumerate(fused[:top_k], 1):
        m = meta[idx]
        bm25_pos = bm25_ranks.get(idx, "—")
        vec_pos = vec_ranks.get(idx, "—")
        print(f"  {rank}. [score={score:.4f}  bm25_rank={bm25_pos}  vec_rank={vec_pos}]  {m['chunk_id']}")
        print(f"      path: {m['path']}")
        print(f"      preview: {m['preview'][:200].replace(chr(10), ' ')}")
        print()


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description="Гибридный поиск BM25 × vectors × RRF")
    p.add_argument("query", nargs="?", help="search query (RU/EN)")
    p.add_argument("--reindex", action="store_true", help="rebuild semantic + BM25 indexes")
    p.add_argument("--top", type=int, default=5, help="top K results (default 5)")
    p.add_argument("--bm25-only", dest="bm25_only", action="store_true",
                   help="только BM25 (точные термины)")
    p.add_argument("--vector-only", dest="vector_only", action="store_true",
                   help="только векторы (смысл)")
    p.add_argument("--rrf-k", type=int, default=60,
                   help="RRF k constant (default 60, индустриальный стандарт)")
    args = p.parse_args()

    if args.reindex:
        reindex()
        return
    if not args.query:
        p.print_help()
        sys.exit(2)
    mode = "bm25" if args.bm25_only else ("vector" if args.vector_only else "hybrid")
    search(args.query, args.top, mode=mode, rrf_k=args.rrf_k)


if __name__ == "__main__":
    main()
