# -*- coding: utf-8 -*-
"""
Сборщик живой матрицы метрик AEMR.

Данные лежат в matrix_data.py: одна запись — одно число на экране.
Скрипт считает готовность каждой метрики, сводку по вкладкам и печатает
готовый документ docs/superpowers/audits/2026-08-22-metrics-matrix.md.

Печать в консоль — только латиницей (Windows cp1251).
"""
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from matrix_data import ROWS, PASSPORT, HEAD, WINDOW_STATES, INVARIANTS, LIFECYCLE, TAB_NOTES, SOURCE_METRICS

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'docs', 'superpowers', 'audits', '2026-08-22-metrics-matrix.md')

FIELDS = ['z', 'p', 'm', 'o', 'b', 'd', 'e']
FIELD_TITLES = ['Утв.', 'Периметр', 'Момент', 'Происх.', 'БЗ', 'Дверь', 'Пустота']


# Пояснение по умолчанию для краткой пометки «~» — по каждой графе своё.
DEFAULT_PART = {
    'z': 'живёт под заголовком-утверждением блока, собственного вывода не несёт',
    'p': 'периметр объявлен блоком, у самого числа подписи нет',
    'm': 'момент назван блоком выше, у самого числа не назван',
    'o': 'источник назван, полной формулы у числа нет',
    'b': 'объяснение есть, но не состава 2.0',
    'd': 'переход есть, но к строкам-основаниям не ведёт',
    'e': 'пустота названа, три рода различены не полностью',
}


def cell(v, field='b'):
    """Значение клетки паспорта: '+', '-' или '~пояснение'. Пустых не бывает."""
    if v == '+':
        return 'есть', 1.0
    if isinstance(v, str) and v.startswith('-'):
        text = v[1:].strip()
        return ('нет: ' + text if text else 'нет'), 0.0
    if isinstance(v, str) and v.startswith('~'):
        text = v[1:].strip() or DEFAULT_PART[field]
        return 'част.: ' + text, 0.5
    raise ValueError('недопустимое значение клетки: %r' % (v,))


def readiness(row):
    total = 0.0
    for f in FIELDS:
        if f not in row:
            raise ValueError('в записи нет графы %s: %r' % (f, row.get('n')))
        _, w = cell(row[f], f)
        total += w
    return total / len(FIELDS)


def plural(n, one, few, many):
    n = abs(int(n))
    if n % 10 == 1 and n % 100 != 11:
        return '%d %s' % (n, one)
    if 2 <= n % 10 <= 4 and not (12 <= n % 100 <= 14):
        return '%d %s' % (n, few)
    return '%d %s' % (n, many)


def pct(x):
    return ('%.0f' % (x * 100)).replace('-0', '0')


def main():
    # ── проверка целостности данных ──
    for r in ROWS:
        for key in ('t', 'c', 'n', 'a', 'why'):
            if not r.get(key):
                raise ValueError('пустая графа %s в записи %r' % (key, r))
        readiness(r)

    tabs = []
    for r in ROWS:
        if r['t'] not in tabs:
            tabs.append(r['t'])

    out = []
    out.append(HEAD)

    # ── §2. Паспорт ──
    out.append(PASSPORT)

    # ── §3. Реестр ──
    out.append('## 3. Реестр метрик: вкладка × карточка × число\n')
    out.append(
        'Единица счёта — самостоятельное число на экране: плитка, колонка таблицы '
        'со значениями, подпись с числом, точка графика, счётчик в шапке блока. '
        'Колонка таблицы считается один раз, а не по числу строк; это сказано, '
        'чтобы счёт можно было воспроизвести.\n'
    )
    header = '| № | Число на экране | Адрес в коде | ' + ' | '.join(FIELD_TITLES) + ' | Готовность | Что мешает довести |'
    sep = '|---|---|---|' + '---|' * len(FIELDS) + '---|---|'

    n_global = 0
    for t in tabs:
        rows = [r for r in ROWS if r['t'] == t]
        avg = sum(readiness(r) for r in rows) / len(rows)
        out.append('### 3.%d. %s — %d метрик, средняя готовность %s %%\n'
                   % (tabs.index(t) + 1, t, len(rows), pct(avg)))
        if t in TAB_NOTES:
            out.append(TAB_NOTES[t] + '\n')
        cards = []
        for r in rows:
            if r['c'] not in cards:
                cards.append(r['c'])
        for c in cards:
            crows = [r for r in rows if r['c'] == c]
            out.append('**%s**\n' % c)
            out.append(header)
            out.append(sep)
            for r in crows:
                n_global += 1
                cells = [cell(r[f], f)[0] for f in FIELDS]
                out.append('| %d | %s | `%s` | %s | %s %% | %s |'
                           % (n_global, r['n'], r['a'], ' | '.join(cells),
                              pct(readiness(r)), r['why']))
            out.append('')

    # ── §4. Сводка ──
    out.append('## 4. Сводка по вкладкам\n')
    out.append('| Вкладка | Метрик | Средняя готовность | Метрик с готовностью ниже 50 % | Слабейшая графа паспорта |')
    out.append('|---|---:|---:|---:|---|')
    tab_avg = []
    for t in tabs:
        rows = [r for r in ROWS if r['t'] == t]
        avg = sum(readiness(r) for r in rows) / len(rows)
        low = sum(1 for r in rows if readiness(r) < 0.5)
        worst_f, worst_v = None, 2.0
        for i, f in enumerate(FIELDS):
            v = sum(cell(r[f], f)[1] for r in rows) / len(rows)
            if v < worst_v:
                worst_v, worst_f = v, FIELD_TITLES[i]
        tab_avg.append((t, len(rows), avg, low))
        out.append('| %s | %d | %s %% | %d | %s (%s %%) |'
                   % (t, len(rows), pct(avg), low, worst_f, pct(worst_v)))
    total_avg = sum(readiness(r) for r in ROWS) / len(ROWS)
    out.append('| **Всего** | **%d** | **%s %%** | **%d** | — |'
               % (len(ROWS), pct(total_avg),
                  sum(1 for r in ROWS if readiness(r) < 0.5)))
    out.append('')

    worst3 = sorted(tab_avg, key=lambda x: x[2])[:3]
    out.append('**Три худшие вкладки:** ' + '; '.join(
        '%s — %s %% (%d метрик)' % (t, pct(a), n) for t, n, a, _ in worst3) + '.\n')

    out.append('**Готовность граф паспорта по продукту в целом**\n')
    out.append('| Графа паспорта | Заполнена | Частично | Нет | Средняя |')
    out.append('|---|---:|---:|---:|---:|')
    for i, f in enumerate(FIELDS):
        full = sum(1 for r in ROWS if r[f] == '+')
        part = sum(1 for r in ROWS if isinstance(r[f], str) and r[f].startswith('~'))
        none = sum(1 for r in ROWS if isinstance(r[f], str) and r[f].startswith('-'))
        avg = sum(cell(r[f], f)[1] for r in ROWS) / len(ROWS)
        out.append('| %s | %d | %d | %d | %s %% |' % (FIELD_TITLES[i], full, part, none, pct(avg)))
    out.append('')

    # ── §5. Состояния окна ──
    out.append(WINDOW_STATES)
    out.append('### 5.3. Инварианты и стражи\n')
    out.append('| № | Инвариант | Страж сегодня | Где | Чего не хватает |')
    out.append('|---|---|---|---|---|')
    guardless = 0
    for i, inv in enumerate(INVARIANTS, 1):
        if inv['guard'] == 'нет':
            guardless += 1
        out.append('| И%d | %s | %s | %s | %s |'
                   % (i, inv['name'], inv['guard'], inv['where'], inv['gap']))
    out.append('')
    out.append('**Инвариантов без стража: %d из %d.** Инвариант считается со стражем, '
               'только когда проверка падает при возврате класса дефекта; '
               '«частичный» страж закрывает часть состояний окна и назван поимённо.\n'
               % (guardless, len(INVARIANTS)))
    part_guard = sum(1 for x in INVARIANTS if x['guard'].startswith('частичный'))
    full_guard = len(INVARIANTS) - guardless - part_guard
    out.append('Из остальных %d стражей полных — %d, частичных — %d. Полная гарантия '
               'есть, таким образом, у %d инвариантов из %d; у остальных %d её нет вовсе '
               'либо она закрывает не все состояния окна. Именно этот счёт, а не число '
               '«без стража вовсе», показывает настоящий объём работы.\n'
               % (len(INVARIANTS) - guardless, full_guard, part_guard,
                  full_guard, len(INVARIANTS), guardless + part_guard))

    # ── §6. Порядок жизни ──
    out.append(LIFECYCLE)

    # ── §7. Метрики самого источника ──
    out.append(SOURCE_METRICS)

    text = '\n'.join(out).rstrip() + '\n'
    with io.open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)

    print('rows=%d tabs=%d avg=%s guard: none=%d partial=%d full=%d of %d'
          % (len(ROWS), len(tabs), pct(total_avg), guardless, part_guard,
             full_guard, len(INVARIANTS)))
    for t, n, a, low in tab_avg:
        print('  tab n=%d avg=%s low=%d' % (n, pct(a), low))


if __name__ == '__main__':
    main()
