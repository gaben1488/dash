# -*- coding: utf-8 -*-
"""
cognee_ingest.py — накачивает cognee знаниями AEMR из всех слоёв памяти.

Источники (в порядке приоритета):
  1) memory/*.md (13 root)                                    — главный canon
  2) memory/data/*.md (11 detail)                             — глубокая модель данных
  3) .mulch/expertise/*.jsonl (133 records → markdown)        — tactical sticky-notes
  4) vault/AEMR/10-Index/NOW.md                               — текущий шаг
  5) vault/AEMR/20-Knowledge/feedback/*.md                    — голос user
  6) vault/AEMR/30-Decisions/*.md                             — ADR
  7) vault/AEMR/50-Workflow/daily/*.md (последние 14 дней)    — pulse history
  8) graphify-out/GRAPH_REPORT.md (если есть)                 — код-карта
  9) selective transcripts (последние 5 сессий)               — диалоги

Не идёт:
  - archive/, _archive/, node_modules/, dist/
  - бинарные файлы
  - aemr.db и другие БД

Usage:
  python scripts/cognee_ingest.py                # full ingest
  python scripts/cognee_ingest.py --canon-only   # только memory/ + data/
  python scripts/cognee_ingest.py --dry-run      # список файлов без ingest
  python scripts/cognee_ingest.py --reset        # стереть cognee-store перед ingest
"""
import os, sys, asyncio, argparse, json, hashlib, time
from pathlib import Path
from datetime import datetime, timedelta

sys.stdout.reconfigure(encoding='utf-8')

# Paths
DASH_ROOT = Path(r'C:\Users\filat\dash')
MEMORY_ROOT = Path(r'C:\Users\filat\.claude\projects\C--Users-filat-dash\memory')
VAULT_ROOT = Path(r'C:\Users\filat\Documents\Obsidian\delete not delete\AEMR')
COGNEE_VENV_PYTHON = Path(r'C:\Users\filat\cognee-pilot\cognee\.venv\Scripts\python.exe')
GRAPHIFY_OUT = DASH_ROOT / 'graphify-out'
TRANSCRIPTS = Path(r'C:\Users\filat\.claude\projects\C--Users-filat-dash')

# State file для отслеживания ingested mtime
STATE_FILE = Path.home() / '.cognee' / 'ingest_state.json'


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding='utf-8'))
    return {'ingested_at': None, 'sources': {}}


def save_state(state):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()[:16]


def collect_sources(scope: str = 'full') -> list[tuple[str, Path, str]]:
    """Возвращает [(layer, path, dataset_name), ...] — порядок задаёт приоритет ingest."""
    out = []

    # 1. memory/*.md (13 root)
    for p in sorted(MEMORY_ROOT.glob('*.md')):
        if p.is_file():
            out.append(('canon-root', p, 'aemr_canon'))

    # 2. memory/data/*.md (11 detail)
    for p in sorted((MEMORY_ROOT / 'data').glob('*.md')):
        out.append(('canon-detail', p, 'aemr_canon'))

    if scope == 'canon-only':
        return out

    # 3. mulch — конвертируем jsonl в один markdown
    mulch_dir = DASH_ROOT / '.mulch' / 'expertise'
    if mulch_dir.exists():
        out.append(('mulch', mulch_dir, 'aemr_mulch'))

    # 4-7. vault
    if VAULT_ROOT.exists():
        now_md = VAULT_ROOT / '10-Index' / 'NOW.md'
        if now_md.exists():
            out.append(('vault-now', now_md, 'aemr_vault'))

        feedback_dir = VAULT_ROOT / '20-Knowledge' / 'feedback'
        for p in sorted(feedback_dir.glob('*.md')) if feedback_dir.exists() else []:
            out.append(('vault-feedback', p, 'aemr_vault'))

        decisions_dir = VAULT_ROOT / '30-Decisions'
        for p in sorted(decisions_dir.glob('*.md')) if decisions_dir.exists() else []:
            out.append(('vault-adr', p, 'aemr_vault'))

        # Daily-pulse — только последние 14 дней
        cutoff = datetime.now() - timedelta(days=14)
        pulse_dir = VAULT_ROOT / '50-Workflow' / 'daily'
        for p in sorted(pulse_dir.glob('*-pulse.md')) if pulse_dir.exists() else []:
            if datetime.fromtimestamp(p.stat().st_mtime) >= cutoff:
                out.append(('vault-pulse', p, 'aemr_vault'))

    # 8. graphify
    graph_report = GRAPHIFY_OUT / 'GRAPH_REPORT.md'
    if graph_report.exists():
        out.append(('graphify', graph_report, 'aemr_code'))

    return out


def mulch_to_markdown(mulch_dir: Path) -> str:
    """Конвертирует .mulch/expertise/*.jsonl в один markdown для cognee."""
    md_lines = ['# Mulch — tactical sticky-notes (133+ records)\n']
    for jsonl in sorted(mulch_dir.glob('*.jsonl')):
        domain = jsonl.stem
        md_lines.append(f'\n## Domain: {domain}\n')
        for line in jsonl.read_text(encoding='utf-8').splitlines():
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            rid = rec.get('id', '?')
            rtype = rec.get('type', '?')
            content = rec.get('content', '')
            tags = ', '.join(rec.get('tags', []))
            md_lines.append(f'\n### {rid} [{rtype}]\n')
            md_lines.append(f'{content}\n')
            if tags:
                md_lines.append(f'\n*tags: {tags}*\n')
    return '\n'.join(md_lines)


async def ingest_with_cognee(sources: list, reset: bool):
    """Запускается через cognee venv Python — этот код будет inline в subprocess."""
    import cognee
    from cognee.api.v1.search import SearchType

    # config
    os.environ.setdefault('COGNEE_DATA_ROOT_DIRECTORY', str(Path.home() / '.cognee' / 'data'))
    os.environ.setdefault('COGNEE_SYSTEM_ROOT_DIRECTORY', str(Path.home() / '.cognee' / 'system'))
    os.environ.setdefault('CACHING', 'false')
    os.environ.setdefault('ENABLE_BACKEND_ACCESS_CONTROL', 'false')

    if reset:
        print('[reset] стираю cognee-store...')
        await cognee.prune.prune_data()
        await cognee.prune.prune_system(metadata=True)
        print('[reset] done')

    state = load_state()
    state['ingested_at'] = datetime.utcnow().isoformat()
    state['sources'] = {}

    # Группируем по dataset
    by_dataset: dict[str, list[tuple[str, str]]] = {}  # dataset → [(layer:filename, content), ...]
    mulch_dir = DASH_ROOT / '.mulch' / 'expertise'

    for layer, path, dataset in sources:
        try:
            if layer == 'mulch':
                content = mulch_to_markdown(path)
                title = 'mulch_expertise.md'
                state['sources']['mulch'] = {'records': sum(1 for _ in path.glob('*.jsonl'))}
            else:
                content = path.read_text(encoding='utf-8', errors='replace')
                title = f'{layer}/{path.name}'
                state['sources'][title] = {
                    'mtime': path.stat().st_mtime,
                    'hash': file_hash(path),
                    'size': path.stat().st_size,
                }

            by_dataset.setdefault(dataset, []).append((title, content))
            print(f'[collect] {layer:18s} → {dataset:12s} | {title} ({len(content):,} chars)')
        except Exception as e:
            print(f'[skip] {path}: {e}')

    # cognee.add для каждого dataset
    for dataset, items in by_dataset.items():
        print(f'\n[add] dataset={dataset} | {len(items)} файлов')
        # Каждый файл = отдельный документ внутри dataset
        documents = [content for _, content in items]
        await cognee.add(documents, dataset_name=dataset)
        print(f'[add] dataset={dataset} | added {len(documents)} docs')

    # cognee.cognify — извлечение entities + графа
    print('\n[cognify] LLM extraction (это займёт минуты)...')
    for dataset in by_dataset:
        try:
            await cognee.cognify(datasets=[dataset])
            print(f'[cognify] {dataset}: ok')
        except Exception as e:
            print(f'[cognify ERROR] {dataset}: {e}')

    save_state(state)
    print(f'\n[done] state saved to {STATE_FILE}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--canon-only', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--reset', action='store_true')
    args = ap.parse_args()

    scope = 'canon-only' if args.canon_only else 'full'
    sources = collect_sources(scope)

    print(f'=== cognee ingest plan ({scope}) ===')
    by_layer = {}
    for layer, path, dataset in sources:
        by_layer.setdefault(layer, []).append((path, dataset))
    for layer, items in by_layer.items():
        total_size = sum(p.stat().st_size if p.is_file() else 0 for p, _ in items)
        print(f'  {layer:18s} | {len(items):3d} sources | {total_size/1024:8,.1f} KB')

    if args.dry_run:
        print('\n[dry-run] не запускаю ingest')
        return

    # Подгружаем cognee-pilot/.env если есть
    env_file = Path(r'C:\Users\filat\cognee-pilot\.env')
    if env_file.exists():
        for line in env_file.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())
        print(f'[env] loaded {env_file}')

    # Проверка наличия LLM_API_KEY (после загрузки .env)
    has_llm_key = bool(os.environ.get('LLM_API_KEY')) or bool(os.environ.get('ANTHROPIC_API_KEY')) or bool(os.environ.get('OPENAI_API_KEY'))
    if not has_llm_key:
        print('\n[WARN] нет LLM_API_KEY — будет vector-only ingest (без entity extraction)')
        print('  для full graph: положи ключ в C:/Users/filat/cognee-pilot/.env')
        print('  пример: cp C:/Users/filat/cognee-pilot/.env.example C:/Users/filat/cognee-pilot/.env')
        os.environ['COGNEE_VECTOR_ONLY'] = '1'

    # Run inside cognee venv через subprocess — иначе ImportError
    if 'COGNEE_VENV_RUN' not in os.environ:
        import subprocess
        env = os.environ.copy()
        env['COGNEE_VENV_RUN'] = '1'
        # передаём LLM_API_KEY если есть ANTHROPIC_API_KEY (только если он не пустой)
        if env.get('ANTHROPIC_API_KEY') and not env.get('LLM_API_KEY'):
            env['LLM_API_KEY'] = env['ANTHROPIC_API_KEY']
            env['LLM_PROVIDER'] = 'anthropic'
            env['LLM_MODEL'] = 'claude-3-5-haiku-20241022'
        env.setdefault('EMBEDDING_PROVIDER', 'fastembed')
        env.setdefault('EMBEDDING_MODEL', 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')
        env.setdefault('COGNEE_DATA_ROOT_DIRECTORY', str(Path.home() / '.cognee' / 'data'))
        env.setdefault('COGNEE_SYSTEM_ROOT_DIRECTORY', str(Path.home() / '.cognee' / 'system'))
        cmd = [str(COGNEE_VENV_PYTHON), __file__]
        if args.canon_only: cmd.append('--canon-only')
        if args.reset: cmd.append('--reset')
        print(f'\n[exec] re-running inside cognee venv: {COGNEE_VENV_PYTHON}')
        result = subprocess.run(cmd, env=env)
        sys.exit(result.returncode)

    # Inside venv — собственно ingest
    asyncio.run(ingest_with_cognee(sources, args.reset))


if __name__ == '__main__':
    main()
