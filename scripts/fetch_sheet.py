"""fetch_sheet.py — прочитать лист «СВОД с месяцами» через gviz CSV (link-shared) и
диагностировать сверку: размеры, состояние фильтров (AN/AO), структуру ALL-блока.
"""
import urllib.request, urllib.parse, sys, csv, io
sys.stdout.reconfigure(encoding="utf-8")

SHEET_ID = "1i692JdP-FqWMSfVgBjTmDCoUakacbJpZMq9tJhQlRhg"
TAB = "СВОД с месяцами"
url = (f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq"
       f"?tqx=out:csv&sheet={urllib.parse.quote(TAB)}")

try:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    raw = urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "replace")
except Exception as e:
    print("FETCH FAIL:", repr(e)); raise SystemExit

if raw.lstrip()[:1] == "<":
    print("Получен HTML (не расшарен / логин-стена). Первые 200 симв:")
    print(raw[:200]); raise SystemExit

rows = list(csv.reader(io.StringIO(raw)))
ncols = max((len(r) for r in rows), default=0)
print(f"TAB '{TAB}' прочитан: {len(rows)} строк x {ncols} колонок")


def c(r, i):
    return r[i] if i < len(r) else ""


# Колонка AN (39) и AO (40) — фильтры (по shdyu-map). Покажем все непустые.
print("\n=== Фильтр-контролы: непустые ячейки в колонках AN(39)/AO(40) ===")
found = 0
for i, r in enumerate(rows, 1):
    an, ao = c(r, 39), c(r, 40)
    if an.strip() or ao.strip():
        print(f"  строка {i}: AN='{an}'  AO='{ao}'")
        found += 1
    if found > 25:
        print("  ...(оборвано)"); break
if not found:
    print("  (пусто в AN/AO — фильтр-колонки не там, или другая геометрия)")

# Шапка + начало ALL-блока (строки 1-20): A,B + первые денежные колонки
print("\n=== Строки 1-20 (A=наимен., B=месяц, C..H = первые числовые) ===")
for i, r in enumerate(rows[:20], 1):
    cells = " | ".join(f"{c(r,j)[:11]}" for j in range(0, 9))
    print(f"{i:3}: {cells}")

# Где встречаются ключевые маркеры (ТД/ПМ/ИТОГО/Доля) — понять реальную раскладку
print("\n=== Маркеры раскладки (поиск 'итого','доля','тд','пм','всего' в кол A) ===")
for i, r in enumerate(rows, 1):
    a = c(r, 0).lower()
    if any(k in a for k in ("итого", "доля", "всего", "квартал")) and i <= 60:
        print(f"  {i}: A='{c(r,0)[:40]}'")
