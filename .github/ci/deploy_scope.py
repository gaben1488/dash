"""Stop documentation-only commits from restarting production services.

GitHub Actions executes this after all ordinary CI checks; it only decides if
the SSH deployment job should run. Unknown changes and missing diff refs block
automatic release, rather than risk an unreviewed production mutation.
"""
from __future__ import annotations

import os
from pathlib import Path
import re
import subprocess
import sys
from collections.abc import Iterable

SHA = re.compile(r"^[0-9a-f]{40}$")


def is_non_runtime(path: str) -> bool:
    path = path.replace("\\", "/")
    return (path.startswith("docs/")
            or path.startswith(".github/")
            or path.lower().endswith((".md", ".mdx", ".rst"))
            or path in {"LICENSE", "LICENSE.txt"})


def runtime_changed(paths: Iterable[str]) -> bool:
    return any(path and not is_non_runtime(path) for path in paths)


def main() -> int:
    before = os.environ.get("BEFORE_SHA", "")
    head = os.environ.get("HEAD_SHA", "")
    if not SHA.fullmatch(before) or not SHA.fullmatch(head) or before == "0" * 40:
        raise SystemExit("DEPLOY_SCOPE_REVISION_NOT_VERIFIED")
    try:
        # A renamed source file must still count as a runtime deletion,
        # even if the new path happens to be a README or documentation file.
        subprocess.run(
            ["git", "merge-base", "--is-ancestor", before, head],
            check=True, capture_output=True, text=True, timeout=60,
        )
        changes = subprocess.run(
            ["git", "diff", "--no-renames", "--name-only",
             "--diff-filter=ACDMRTUXB", before, head],
            capture_output=True, text=True, check=True, timeout=60,
        ).stdout.splitlines()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise SystemExit("DEPLOY_SCOPE_DIFF_UNAVAILABLE") from exc
    required = runtime_changed(changes)
    # Do not emit source file contents, deployment secrets or private data.
    print(f"Deployment decision: {'runtime changed' if required else 'docs/CI only'}; files: {len(changes)}")
    output = os.environ.get("GITHUB_OUTPUT")
    if not output:
        raise SystemExit("DEPLOY_SCOPE_OUTPUT_UNAVAILABLE")
    with Path(output).open("a", encoding="utf-8") as handle:
        handle.write(f"runtime_changed={'true' if required else 'false'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
