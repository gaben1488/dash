@echo off
REM Weekly pulse runner — invoked by Windows Task Scheduler (task "AEMR-Weekly-Pulse").
REM Writes the digest to vault/50-Workflow/weekly/. Replaces the old per-turn daily pulse.
"C:\Users\filat\AppData\Local\Programs\Python\Python312\python.exe" "C:\Users\filat\dash\scripts\weekly_pulse.py" --write
