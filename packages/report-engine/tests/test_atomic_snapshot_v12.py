import unittest

from procurement_engine.atomic_snapshot import (
    AtomicSnapshotError,
    SourcePayload,
    capture_atomic_snapshot,
    validate_at_publish,
)


class FakeAdapter:
    def __init__(self, source_id, *, revisions, values=None, allowed=("fp",), fingerprint="fp"):
        self.source_id = source_id
        self.role = "master_register"
        self.provider_id = f"provider-{source_id}"
        self._revisions = list(revisions)
        self._rev_i = 0
        self.values = values if values is not None else [[source_id, 1]]
        self._allowed = allowed
        self.fingerprint = fingerprint
        self.calls = []

    @property
    def allowed_schema_fingerprints(self):
        return self._allowed

    def revision_token(self):
        self.calls.append("revision")
        if not self._revisions:
            return None
        i = min(self._rev_i, len(self._revisions) - 1)
        value = self._revisions[i]
        self._rev_i += 1
        return value

    def read_payload(self):
        self.calls.append("read")
        return SourcePayload(
            source_id=self.source_id, role=self.role, provider_id=self.provider_id,
            semantic_values=self.values, sheet_or_tab_id="sheet1", schema_fingerprint=self.fingerprint,
        )


class ScriptedAdapter:
    """Revision tokens are emitted per call so tests can model global BEFORE/AFTER/retry barriers."""
    def __init__(self, source_id, tokens, values=None):
        self.source_id=source_id; self.role="master_register"; self.provider_id=f"p-{source_id}"
        self.tokens=list(tokens); self.i=0; self.values=values or [[source_id]]; self.calls=[]
    @property
    def allowed_schema_fingerprints(self): return ("fp",)
    def revision_token(self):
        self.calls.append("revision")
        token=self.tokens[min(self.i,len(self.tokens)-1)]; self.i+=1; return token
    def read_payload(self):
        self.calls.append("read")
        return SourcePayload(self.source_id,self.role,self.provider_id,self.values,schema_fingerprint="fp")


class AtomicSnapshotV12Tests(unittest.TestCase):
    def test_stable_capture_is_deterministic_and_carries_barriers(self):
        a=ScriptedAdapter("A", ["r1","r1"])  # BEFORE, AFTER
        b=ScriptedAdapter("B", ["r2","r2"])
        bundle=capture_atomic_snapshot([a,b], report_date="29.09.2026", report_year=2026,
                                       rules_version="rules", renderer_version="renderer", cutoff_at="2026-09-29T08:00:00Z")
        self.assertEqual(bundle.attempt,1)
        self.assertEqual(bundle.before,bundle.after)
        self.assertEqual(bundle.manifest["snapshot_contract_version"],"snapshot-v2.2.0")
        self.assertTrue(bundle.manifest["atomic_capture"]["before_after_equal"])
        self.assertEqual({x["source_id"] for x in bundle.manifest["sources"]},{"A","B"})

    def test_full_capture_retries_when_any_source_drifts(self):
        # attempt1 BEFORE=r1 AFTER=r2 -> discard; attempt2 BEFORE=r2 AFTER=r2 -> accept
        a=ScriptedAdapter("A", ["r1","r2","r2","r2"])
        b=ScriptedAdapter("B", ["x","x","x","x"])
        bundle=capture_atomic_snapshot([a,b], report_date="29.09.2026", report_year=2026,
                                       rules_version="rules", renderer_version="renderer", max_attempts=2)
        self.assertEqual(bundle.attempt,2)
        self.assertEqual(a.calls.count("read"),2)
        self.assertEqual(b.calls.count("read"),2)

    def test_capture_fails_closed_after_retry_budget(self):
        # before1, after1, before2, after2
        a=ScriptedAdapter("A", ["r1","r2","r3","r4"])
        with self.assertRaisesRegex(AtomicSnapshotError,"SOURCE_CHANGED_DURING_FREEZE:A"):
            capture_atomic_snapshot([a], report_date="29.09.2026", report_year=2026,
                                    rules_version="rules", renderer_version="renderer", max_attempts=2)

    def test_unknown_schema_blocks_before_snapshot(self):
        a=ScriptedAdapter("A", ["r1","r1"])
        def bad_read():
            return SourcePayload("A","master_register","p-A",[[1]],schema_fingerprint="unknown")
        a.read_payload=bad_read
        with self.assertRaisesRegex(AtomicSnapshotError,"SOURCE_SCHEMA_CHANGED:A"):
            capture_atomic_snapshot([a], report_date="29.09.2026", report_year=2026,
                                    rules_version="rules", renderer_version="renderer")

    def test_missing_revision_metadata_blocks_atomic_live_capture(self):
        a=FakeAdapter("A", revisions=[None])
        with self.assertRaisesRegex(AtomicSnapshotError,"ATOMIC_SOURCE_REVISION_UNAVAILABLE:A"):
            capture_atomic_snapshot([a], report_date="29.09.2026", report_year=2026,
                                    rules_version="rules", renderer_version="renderer")

    def test_at_publish_detects_post_freeze_change(self):
        a=ScriptedAdapter("A", ["r2"])
        issues=validate_at_publish([a], {"A":"r1"})
        self.assertEqual([x.code for x in issues],["SOURCE_CHANGED_AFTER_FREEZE"])

    def test_payload_provider_identity_mismatch_blocks(self):
        a=ScriptedAdapter("A", ["r1","r1"])
        def bad_read(): return SourcePayload("A","master_register","wrong",[[1]],schema_fingerprint="fp")
        a.read_payload=bad_read
        with self.assertRaisesRegex(AtomicSnapshotError,"SOURCE_PROVIDER_ID_MISMATCH:A"):
            capture_atomic_snapshot([a], report_date="29.09.2026", report_year=2026,
                                    rules_version="rules", renderer_version="renderer")


if __name__ == "__main__": unittest.main()


def test_explicit_provider_revision_scope_is_shared_only_within_one_barrier():
    a = ScriptedAdapter('A', ['r1', 'r2', 'r2', 'r2'])
    b = ScriptedAdapter('B', ['unused'])
    a.provider_id = b.provider_id = 'one-book'
    a.revision_scope = b.revision_scope = 'provider'
    bundle = capture_atomic_snapshot([a, b], report_date='30.09.2026', report_year=2026,
        rules_version='rules', renderer_version='renderer', max_attempts=2)
    assert bundle.attempt == 2
    assert bundle.before == bundle.after == {'A': 'r2', 'B': 'r2'}
    assert a.calls.count('revision') == 4
    assert b.calls.count('revision') == 0
    assert a.calls.count('read') == b.calls.count('read') == 2


def test_failed_barrier_preserves_private_observed_versions():
    import pytest

    a = ScriptedAdapter('A', ['private-before', 'private-after'])
    with pytest.raises(AtomicSnapshotError) as failure:
        capture_atomic_snapshot([a], report_date='30.09.2026', report_year=2026,
            rules_version='rules', renderer_version='renderer', max_attempts=1)
    assert failure.value.evidence == {'attempts': 1,
        'before': {'A': 'private-before'}, 'after': {'A': 'private-after'}}
