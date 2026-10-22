"""Execute candidate inventory modules in memory; production state stays read-only."""
import json
import sqlite3
import sys
import types
from pathlib import Path

for name in ('readonly_catalog', 'storage_inventory'):
    text = sys.stdin.readline()
    source = json.loads(text)
    module = types.ModuleType('procurement_engine.' + name)
    module.__package__ = 'procurement_engine'
    sys.modules[module.__name__] = module
    exec(compile(source, '<reviewed-storage-probe>', 'exec'), module.__dict__)

try:
    result = sys.modules['procurement_engine.storage_inventory'].inventory_state(
        Path('/app/packages/server/data'))
except (OSError, ValueError, sqlite3.DatabaseError) as error:
    result = {'storage_inventory': 'UNAVAILABLE', 'error_class': type(error).__name__}
print(json.dumps({'report_storage_inventory': result}, sort_keys=True))
