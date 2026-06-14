"""gut_branch.py — «выпотрошить» дохлую ветку: оставить только tombstone-md.

Создаёт через git-data API коммит, дерево которого содержит РОВНО один файл
(BRANCH_CLOSED.md), родитель = текущий tip ветки. Всё остальное «удаляется» одним
коммитом (но остаётся в истории). Гейт не нужен — ветка не вливается в main.
"""
import base64, json, subprocess, sys
sys.stdout.reconfigure(encoding="utf-8")

OWNER, REPO, BR = "gaben1488", "dash", "feature/svod-modes"

MD = """# feature/svod-modes — ВЕТКА ЗАКРЫТА (2026-06-06)

Содержимое ветки удалено намеренно. Остался только этот файл. Ниже — почему, и где
лежит всё «удалённое» (ничего не потеряно, всё восстановимо из истории git).

## Почему закрыта
Ветка форкнута от старой базы (`8d283fe`) — ДО фиксов amount_dev, дед-кода, grbs и
change-history — и отстала от `main` на десятки коммитов. Влить её нельзя: это вернуло
бы баги (см. ниже). Чтобы ветка не путала ревьюеров и не была случайно смёржена, её
содержимое свёрнуто в этот tombstone.

## Что было уникального — и почему ничего не потеряно
1. **Дизайн-док `docs/SVOD_MODES_DESIGN.md`** — единственная оригинальная ценность ветки.
   **Уже в `main`** (коммит `26d1bb4`). Идентичен. Не потерян.
2. **Устаревшие версии файлов** (`calc-engine.ts`, `orchestrator.ts`, `reconcile.ts`,
   `store.ts`, `unified-svod.ts` и др.). В ветке — СТАРЫЕ варианты. Особо: `calc-engine.ts`
   несёт `amount_deviation = план−факт` (баг ложного 200%-расхождения); в `main` давно
   `факт−план`. Merge вернул бы баг. Это не потеря, а намеренно вытесненные версии.
3. **16 «дед-сирот»** — файлы с 0 импортёров, удалённые из `main` при консолидации:
   `server/services/pipeline.ts`,
   `web/components/{FilterBar,Sidebar,KBTooltip,CalendarHeatmap}.tsx`,
   `web/components/charts/index.tsx`,
   `web/components/dashboard/{BudgetDonut,ExecutionOverview,QuarterlyChart,SignalGrid,StatusLine,index}`,
   `web/components/filters/{DeptTreePicker,MonthStrip,OrgRail,YearScroller}.tsx`.
   Не потеряны — лежат в истории на коммите `b57aaa7` (база ребренда, прямой предок main).
   Поднять: `git checkout b57aaa7 -- <путь>`.

## ВАЖНО для будущего Режима B («СВОД с месяцами» как отдельная страница)
Среди дед-сирот — готовая заготовка под помесячную СВОД-страницу:
`web/components/filters/{MonthStrip,YearScroller,OrgRail,DeptTreePicker}.tsx`
и виджеты `web/components/dashboard/*`. Если будешь делать Режим B — это кирпичи,
которые можно поднять из `b57aaa7` вместо написания с нуля.

— Закрыто Claude (царь ветки `svod-rebrand-ui`), 2026-06-06.
"""


def gh(args, body=None):
    p = subprocess.run(
        ["gh", "api"] + args,
        input=(json.dumps(body) if body is not None else None),
        capture_output=True, text=True, encoding="utf-8",
    )
    if p.returncode != 0:
        sys.stderr.write(f"ERR {args[:3]}: {p.stderr[:500]}\n")
    return p.stdout.strip()


tip = subprocess.run(["git", "rev-parse", "origin/feature/svod-modes"],
                     capture_output=True, text=True).stdout.strip()
print("tip:", tip)

blob = json.loads(gh([f"repos/{OWNER}/{REPO}/git/blobs", "-X", "POST", "--input", "-"],
                     {"content": base64.b64encode(MD.encode()).decode(), "encoding": "base64"}))["sha"]
print("blob:", blob)

tree = json.loads(gh([f"repos/{OWNER}/{REPO}/git/trees", "-X", "POST", "--input", "-"],
                     {"tree": [{"path": "BRANCH_CLOSED.md", "mode": "100644", "type": "blob", "sha": blob}]}))["sha"]
print("tree:", tree)

commit = json.loads(gh([f"repos/{OWNER}/{REPO}/git/commits", "-X", "POST", "--input", "-"],
                       {"message": "chore: закрыть ветку svod-modes — всё ценное в main, остальное в истории (BRANCH_CLOSED.md)",
                        "tree": tree, "parents": [tip]}))["sha"]
print("commit:", commit)

res = gh([f"repos/{OWNER}/{REPO}/git/refs/heads/{BR}", "-X", "PATCH", "--input", "-"], {"sha": commit})
ok = commit[:12] in res
print("ref updated:", "OK" if ok else res[:300])
"""done"""
print("done")
