"""Stop-hook: детектор дрейфа памяти.

Проблема (сессия 2026-07-13): день полон коммитов-вех, а в .mulch за день ноль записей —
эволюция знаний молча не происходит, PreCompact-хук синкает только уже созданное.

Правило: если сегодня есть коммиты в репо, но нет ни одной mulch-записи с сегодняшней
датой — печатаем громкое напоминание в конец хода. Не блокируем (exit 0 всегда):
напоминание в каждом ходе достаточно назойливо, а ложный блок опаснее.
"""
import datetime
import glob
import io
import json
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def commits_today() -> int:
    today = datetime.date.today().isoformat()
    try:
        out = subprocess.run(
            ["git", "log", "--oneline", f"--since={today} 00:00", "--until=now"],
            capture_output=True, text=True, cwd=REPO, timeout=10,
        ).stdout
        return len([l for l in out.splitlines() if l.strip()])
    except Exception:
        return 0


def mulch_records_recent(hours: int = 16) -> int:
    """Записи за последние N часов. recorded_at в mulch — UTC ISO; сравнение
    по локальной дате ловит таймзонный сдвиг (Камчатка UTC+12), поэтому окно."""
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=hours)
    count = 0
    for path in glob.glob(os.path.join(REPO, ".mulch", "expertise", "*.jsonl")):
        try:
            with io.open(path, encoding="utf-8") as f:
                for line in f:
                    try:
                        rec = json.loads(line)
                        ts = rec.get("recorded_at", "")
                        when = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
                        if when >= cutoff:
                            count += 1
                    except (ValueError, json.JSONDecodeError):
                        continue
        except OSError:
            continue
    return count


def main() -> int:
    n_commits = commits_today()
    if n_commits < 3:  # мелкий день — не шумим
        return 0
    if mulch_records_recent() > 0:
        return 0
    sys.stdout.reconfigure(encoding="utf-8")
    print(
        f"[memory-drift] Сегодня {n_commits} коммитов и НОЛЬ mulch-записей. "
        "Эволюция знаний не происходит. Запиши уроки вехи СЕЙЧАС: "
        "ml record <domain> --type <t> ... && ml sync (правило: запись в момент вехи, не в конце сессии)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
