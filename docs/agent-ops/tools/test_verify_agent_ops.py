"""No external service required: negative cases must fail closed."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import csv
import tempfile
import unittest
from verify_agent_ops import check_corpus, check_handoff

SHA = "0" * 39 + "1"


def sample(kind="docs", stage="proposal"):
    return {
        "change_id": "issue-123", "repo_sha": SHA, "agent": "Claude",
        "owner": "primary-integrator", "kind": kind, "stage": stage,
        "scope": ["docs/agent-ops/README.md"], "reason": "Изменение общего протокола",
        "next_action": "Уточнить статус", "evidence": {}, "remaining_risks": []
    }


class Handoff(unittest.TestCase):
    def test_proposal_does_not_claim_success(self):
        self.assertTrue(check_handoff(sample())["ok"])

    def test_accepted_cannot_be_self_asserted(self):
        r = sample("code", "accepted")
        r["tests"] = {"command": "pnpm -r test", "result": "passed"}
        r["diff_ref"] = "https://github.com/example/project/pull/1"
        self.assertFalse(check_handoff(r)["ok"])

    def test_writing_to_spreadsheet_needs_source_guard(self):
        r = sample("source_write", "branch")
        r["diff_ref"] = "https://github.com/example/project/pull/1"
        self.assertFalse(check_handoff(r)["ok"])

    def test_source_guard_and_readback_structure(self):
        r = sample("source_write", "source_verified")
        r["diff_ref"] = "https://github.com/example/project/pull/1"
        r["tests"] = {"command": "test", "result": "passed"}
        r["source_guard"] = {k: "verified-reference" for k in
            ("source_id", "source_revision", "snapshot_before", "approved_plan", "rollback_ref", "consumer_matrix")}
        r["evidence"] = {"source_readback_ref": "saved-readback", "same_snapshot_ref": "saved-parity"}
        self.assertTrue(check_handoff(r)["ok"])

    def test_deployment_must_match_tested_commit(self):
        r = sample("code", "deployed")
        r["diff_ref"] = "https://github.com/example/project/pull/1"
        r["tests"] = {"command": "pnpm test", "result": "passed"}
        r["evidence"] = {"ci_ref": "test-ci-run", "head_sha": SHA}
        r["release_evidence"] = {k: "evidence-ref" for k in
             ("release_id", "backup_ref", "readback_ref", "rollback_ref")}
        r["release_evidence"]["deployed_sha"] = "f" * 40
        self.assertFalse(check_handoff(r)["ok"])

    def test_no_path_traversal(self):
        r = sample()
        r["scope"] = ["../../private/keys.json"]
        self.assertFalse(check_handoff(r)["ok"])


class Corpus(unittest.TestCase):
    def test_exact_file_and_sha_pass(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            src = root / "source"; src.mkdir()
            (src / "README.md").write_text("test", encoding="utf-8")
            ledger = root / "ledger.csv"
            with ledger.open("w", encoding="utf-8", newline="") as fh:
                wr = csv.DictWriter(fh, fieldnames=["path", "git_sha", "sha256", "bytes", "read_state"])
                wr.writeheader();wr.writerow({"path": "README.md", "git_sha": SHA,
                    "sha256": hashlib.sha256(b"test").hexdigest(), "bytes": 4,
                    "read_state": "indexed_fulltext"})
            self.assertTrue(check_corpus(ledger, src)["ok"])
            (src / "README.md").write_text("tampered", encoding="utf-8")
            self.assertFalse(check_corpus(ledger, src)["ok"])


if __name__ == "__main__":
    unittest.main()
