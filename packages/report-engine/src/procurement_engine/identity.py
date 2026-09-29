from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field

from .models import IdentityEdge, ValidationIssue

ALLOWED_RELATIONS = {"REPLACES", "MERGES_INTO", "SPLITS_INTO", "SAME_AS", "SUPERSEDES"}


@dataclass
class IdentityGraph:
    edges: list[IdentityEdge] = field(default_factory=list)

    def add(self, edge: IdentityEdge) -> None:
        if edge.relation not in ALLOWED_RELATIONS:
            raise ValueError(f"Unsupported identity relation: {edge.relation}")
        if not edge.source_id or not edge.target_id:
            raise ValueError("Identity edges require non-empty source/target ids")
        self.edges.append(edge)

    def successors(self, source_id: str, relations: set[str] | None = None) -> list[str]:
        rel = relations or ALLOWED_RELATIONS
        return [e.target_id for e in self.edges if e.source_id == source_id and e.relation in rel]

    def terminal_replacements(self, source_ids: list[str]) -> list[str]:
        """Return terminal replacement/merge nodes, cycle-safe and deterministic."""
        rel = {"REPLACES", "MERGES_INTO", "SUPERSEDES", "SAME_AS"}
        out: set[str] = set()
        for start in source_ids:
            q = deque([start])
            seen: set[str] = set()
            last: set[str] = set()
            while q:
                node = q.popleft()
                if node in seen:
                    continue
                seen.add(node)
                nxt = self.successors(node, rel)
                if nxt:
                    q.extend(nxt)
                else:
                    last.add(node)
            out.update(last)
        return sorted(out)

    def validate(self) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        adjacency: dict[str, list[str]] = defaultdict(list)
        for e in self.edges:
            if e.relation in {"REPLACES", "MERGES_INTO", "SUPERSEDES"}:
                adjacency[e.source_id].append(e.target_id)
        visiting: set[str] = set()
        visited: set[str] = set()

        def dfs(node: str, path: list[str]):
            if node in visiting:
                issues.append(ValidationIssue(
                    "ERROR", "IDENTITY_CYCLE", "Cycle in replacement graph",
                    {"path": path + [node]}
                ))
                return
            if node in visited:
                return
            visiting.add(node)
            for nxt in adjacency.get(node, []):
                dfs(nxt, path + [node])
            visiting.remove(node)
            visited.add(node)

        for node in list(adjacency):
            dfs(node, [])
        return issues


def validate_procurement_uids(rows, *, require_all: bool = False) -> list[ValidationIssue]:
    """Validate persisted immutable identity without inventing it from column A.

    Missing UIDs are warnings unless a production caller explicitly requires complete
    immutable identity. Duplicate non-empty UIDs are always blocking because they would
    collapse distinct procurement entities.
    """
    issues: list[ValidationIssue] = []
    by_uid: dict[str, list[str]] = defaultdict(list)
    missing = []
    for row in rows:
        uid = getattr(row, "procurement_uid", None)
        physical = getattr(row, "physical_row_key", None) or getattr(row, "procurement_id", "")
        if uid:
            by_uid[uid].append(physical or "")
        else:
            missing.append(physical or "")
    for uid, keys in sorted(by_uid.items()):
        if len(keys) > 1:
            issues.append(ValidationIssue(
                "ERROR", "PROCUREMENT_UID_DUPLICATE",
                f"immutable procurement_uid {uid!r} is assigned to multiple rows",
                {"procurement_uid": uid, "rows": keys},
            ))
    if missing:
        issues.append(ValidationIssue(
            "ERROR" if require_all else "WARN",
            "PROCUREMENT_UID_MISSING",
            f"{len(missing)} procurement row(s) have no persisted immutable procurement_uid",
            {"count": len(missing), "sample_rows": missing[:20]},
        ))
    return issues
