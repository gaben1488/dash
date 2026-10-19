"""Run reviewed maintenance modules against the installed runtime, without patching it."""
from pathlib import Path

import procurement_engine

procurement_engine.__path__.insert(0, str(Path(__file__).resolve().parent))

from procurement_engine.publication_retention import main

if __name__ == '__main__':
    raise SystemExit(main())
