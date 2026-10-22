"""Stop documentation-only commits from restarting production services.

GitHub Actions executes this after all ordinary CI checks; it only decides if
the SSH deployment job should run. Unknown changes and missing diff refs block
automatic release, rather than risk an unreviewed production mutation.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from collections.abc import Iterable
from pathlib import Path

SHA = re.compile(r"^[0-9a-f]{40}$")


def is_non_runtime(path: str) -> bool:
    path = path.replace("\\", "/")
    return (path.startswith(("docs/", ".github/"))
            # A markdown file under runtime packages may be a template/input.
            # Only known non-runtime root files are exempt.
            or path in {"README.md", "AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md",
                        "LICENSE", "LICENSE.txt"})


def runtime_changed(paths: Iterable[str]) -> bool:
    return any(path and not is_non_runtime(path) for path in paths)


def rehearsal_required(paths: Iterable[str]) -> bool:
    # Checker changes and document inputs still require native validation.
    return any(path and (not is_non_runtime(path) or path.startswith(".github/")
               or (path.startswith("docs/") and not path.endswith(".md"))) for path in paths)


def main() -> int:
    rehearsal = sys.argv[1:] == ["--rehearsal"]
    before = os.environ.get("BEFORE_SHA", "")
    head = os.environ.get("HEAD_SHA", "")
    refs_known = bool(SHA.fullmatch(before) and SHA.fullmatch(head) and before != "0" * 40)
    if not refs_known and not rehearsal:
        raise SystemExit("DEPLOY_SCOPE_REVISION_NOT_VERIFIED")
    changes = None
    try:
        # A renamed source file must still count as a runtime deletion,
        # even if the new path happens to be a README or documentation file.
        if not refs_known:
            raise ValueError("unknown comparison")
        subprocess.run(
            ["git", "merge-base", "--is-ancestor", before, head],
            check=True, capture_output=True, text=True, timeout=60,
        )
        changes = subprocess.run(
            ["git", "diff", "--no-renames", "--name-only",
             "--diff-filter=ACDMRTUXB", before, head],
            capture_output=True, text=True, check=True, timeout=60,
        ).stdout.splitlines()
    except (ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        if not rehearsal:
            raise SystemExit("DEPLOY_SCOPE_DIFF_UNAVAILABLE") from exc
    required = (changes is None or rehearsal_required(changes)) if rehearsal else runtime_changed(changes)
    # Do not emit source file contents, deployment secrets or private data.
    if rehearsal:
        print(f"Rehearsal decision: {'required' if required else 'documentation only'}; files: {len(changes) if changes is not None else 'unknown'}")
    else:
        print(f"Deployment decision: {'runtime changed' if required else 'docs/CI only'}; files: {len(changes)}")
    output = os.environ.get("GITHUB_OUTPUT")
    if not output:
        raise SystemExit("DEPLOY_SCOPE_OUTPUT_UNAVAILABLE")
    with Path(output).open("a", encoding="utf-8") as handle:
        handle.write(f"{'native_required' if rehearsal else 'runtime_changed'}={'true' if required else 'false'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
