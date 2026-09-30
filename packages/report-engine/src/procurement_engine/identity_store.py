"""Persistent identity observations; unique plan continuity, never number-only joins.

SQLite transactions serialize competing imports. Snapshots are immutable and
idempotent. Identical duplicates and changed identifying fields stay unresolved. Missing
rows are observations of absence, not proof of cancellation or completion.
"""
import hashlib
import json
import sqlite3
import uuid
from collections import Counter, defaultdict
from contextlib import closing
from dataclasses import asdict, replace
from datetime import datetime
from pathlib import Path


def encoded(v):
    return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':'))

def signature(row):
    data=asdict(row)
    for key in ('snapshot_id','procurement_id','source_row_no','row_number','sheet_name','procurement_uid'):
        data.pop(key,None)
    return hashlib.sha256(encoded(data).encode()).hexdigest()

def continuity_signature(row):
    """Evidence for an ordinary observation update, separate from the full state hash.

    Require the same business number as well as this fingerprint. Plan, subject,
    institution and procedure changes still require explicit reviewed evidence.
    """
    data = asdict(row)
    for key in ('snapshot_id', 'procurement_id', 'source_row_no', 'row_number',
                'sheet_name', 'procurement_uid', 'actual_date', 'fact_fb', 'fact_kb',
                'fact_mb', 'stored_fact_total', 'saving_fb', 'saving_kb', 'saving_mb',
                'stored_saving_total', 'include_saving', 'deviation_reason',
                'grbs_comment', 'monitoring_note', 'missing_money_fields'):
        data.pop(key, None)
    data['missing_plan_fields'] = sorted(set(row.missing_money_fields) & {'H', 'I', 'J'})
    return hashlib.sha256(encoded(data).encode()).hexdigest()


def _resolved_observations(db, observations, instant):
    """Project dated reviews without rewriting immutable snapshot results."""
    result = [dict(item) for item in observations]
    assigned = set()
    for item in result:
        evidence = json.loads(item['evidence'])
        reviews = [dict(review) for review in db.execute(
            'SELECT * FROM reviews WHERE snapshot_id=? AND locator=? ORDER BY reviewed_at, review_id',
            (item['snapshot_id'], item['locator']))
            if datetime.fromisoformat(review['reviewed_at']) <= instant]
        decisions = {review['uid'] for review in reviews}
        if len(decisions) > 1:
            raise ValueError('IDENTITY_REVIEW_CONFLICT')
        if reviews:
            item['uid'] = reviews[0]['uid']
            item['status'] = 'REVIEWED_CONTINUITY'
            evidence['review_ids'] = [review['review_id'] for review in reviews]
        if item['uid']:
            if item['uid'] in assigned:
                raise ValueError('IDENTITY_REVIEW_UID_COLLISION')
            assigned.add(item['uid'])
        item['evidence'] = encoded(evidence)
    return result


def _project_result(db, outcome, instant):
    observations = _resolved_observations(db, db.execute(
        'SELECT * FROM observations WHERE snapshot_id=? ORDER BY locator', (outcome['snapshot_id'],)), instant)
    outcome['rows'] = [{'source_row_key': item['locator'], 'procurement_uid': item['uid'],
                       'status': item['status'], 'evidence': json.loads(item['evidence'])}
                      for item in observations]
    outcome['unresolved_count'] = sum(item['uid'] is None for item in observations)
    assigned = {item['uid'] for item in observations if item['uid']}
    outcome['absent_previous_uids'] = [uid for uid in outcome['absent_previous_uids'] if uid not in assigned]
    return outcome


def anchor(row):
    return encoded([row.source_id,row.grbs,row.institution,row.subject,row.planned_year])


def plan_signature(row):
    fields = ('source_id', 'grbs', 'institution', 'subject', 'activity_kind',
              'planned_date', 'planned_quarter', 'planned_year',
              'plan_fb', 'plan_kb', 'plan_mb', 'stored_plan_total')
    data = {key: getattr(row, key) for key in fields}
    data['missing_plan_fields'] = sorted(set(row.missing_money_fields) & {'H', 'I', 'J'})
    return hashlib.sha256(encoded(data).encode()).hexdigest()


def _check_integrity(db):
    try:
        valid = [tuple(row) for row in db.execute('PRAGMA integrity_check')] == [('ok',)]
    except sqlite3.DatabaseError:
        valid = False
    if not valid:
        raise ValueError('IDENTITY_DATABASE_CORRUPT')


class IdentityStore:
    def __init__(self,path):
        self.path=Path(path);self.path.parent.mkdir(parents=True,exist_ok=True)
        with closing(self.connect()) as db, db:
            _check_integrity(db)
            db.executescript('''
            CREATE TABLE IF NOT EXISTS snapshots (
                seq INTEGER PRIMARY KEY, snapshot_id TEXT UNIQUE NOT NULL,
                digest TEXT NOT NULL, captured_at TEXT NOT NULL, result TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS observations (
                snapshot_id TEXT NOT NULL, locator TEXT NOT NULL, signature TEXT NOT NULL,
                source_id TEXT NOT NULL, business_id TEXT, anchor TEXT NOT NULL,
                uid TEXT, status TEXT NOT NULL, evidence TEXT NOT NULL,
                PRIMARY KEY(snapshot_id,locator));
            CREATE TABLE IF NOT EXISTS reviews (
                review_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, locator TEXT NOT NULL,
                uid TEXT NOT NULL, reviewer TEXT NOT NULL, reviewed_at TEXT NOT NULL,
                evidence TEXT NOT NULL);
            ''')
            db.execute('BEGIN IMMEDIATE')
            if 'plan_signature' not in {r['name'] for r in db.execute('PRAGMA table_info(observations)')}:
                db.execute('ALTER TABLE observations ADD COLUMN plan_signature TEXT')
    def connect(self):
        db=sqlite3.connect(self.path,timeout=30);db.row_factory=sqlite3.Row
        return db

    def backfill_plan_signatures(self, rows, *, snapshot_id):
        """Recover nullable migration metadata, never rewrite frozen import results."""
        rows = list(rows)
        if len({r.physical_row_key for r in rows}) != len(rows):
            raise ValueError('IDENTITY_BACKFILL_LOCATORS_INVALID')
        updated = 0
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            locators = {r['locator'] for r in db.execute(
                'SELECT locator FROM observations WHERE snapshot_id=?', (snapshot_id,))}
            if not locators or {r.physical_row_key for r in rows} != locators:
                raise ValueError('IDENTITY_BACKFILL_COVERAGE_INCOMPLETE')
            for row in rows:
                prior = db.execute('SELECT * FROM observations WHERE snapshot_id=? AND locator=?',
                                   (snapshot_id, row.physical_row_key)).fetchone()
                if (row.snapshot_id != snapshot_id or prior is None
                    or prior['signature'] != signature(row) or prior['uid'] != row.procurement_uid):
                    raise ValueError('IDENTITY_BACKFILL_EVIDENCE_MISMATCH')
                fp = plan_signature(row)
                if prior['plan_signature'] not in (None, fp):
                    raise ValueError('IDENTITY_BACKFILL_SIGNATURE_CONFLICT')
                if prior['plan_signature'] is None:
                    db.execute('UPDATE observations SET plan_signature=? WHERE snapshot_id=? AND locator=?',
                               (fp, snapshot_id, row.physical_row_key))
                    updated += 1
        return updated

    def recover_latest_plan_signatures(self, bundle_roots):
        """Recover the complete previous import from its sealed source payloads."""
        from .adapters import normalize_master_values
        from .snapshot_bundle_io import verify_persisted_bundle

        with closing(self.connect()) as db:
            latest = db.execute('SELECT snapshot_id FROM snapshots ORDER BY seq DESC LIMIT 1').fetchone()
            if latest is None:
                return 0
            sid = latest['snapshot_id']
            missing = db.execute('SELECT count(*) FROM observations WHERE snapshot_id=? AND plan_signature IS NULL', (sid,)).fetchone()[0]
            if not missing:
                return 0
        frozen = read_saved_identity(self.path, sid)
        uids = {r['source_row_key']: r['procurement_uid'] for r in frozen['rows']}
        for root in bundle_roots:
            root = Path(root); path = root / 'manifest.json'
            if not path.is_file():
                continue
            manifest = json.loads(path.read_text())
            if manifest.get('snapshot_id') != sid:
                continue
            entries = manifest.get('payload_index') or []
            if any(not isinstance(item.get('path'), str) or Path(item['path']).is_absolute()
                   or '..' in Path(item['path']).parts for item in entries):
                raise ValueError('IDENTITY_BACKFILL_DONOR_INVALID')
            if verify_persisted_bundle(root):
                raise ValueError('IDENTITY_BACKFILL_DONOR_INVALID')
            rows = []
            for item in entries:
                payload = json.loads((root / item['path']).read_text())
                if payload['role'] != 'master':
                    continue
                meta = payload['metadata']
                rows.extend(normalize_master_values(payload['semantic_values'], snapshot_id=sid,
                    expected_grbs=meta['grbs'], data_start_row=meta.get('header_rows', 3), source_id=payload['provider_id'],
                    sheet_name=meta['sheet_title']))
            rows = [replace(r, procurement_uid=uids.get(r.physical_row_key)) for r in rows]
            return self.backfill_plan_signatures(rows, snapshot_id=sid)
        # Missing optional identity history must not erase current rows or invent links.
        return 0

    def ingest(self,rows,*,snapshot_id,captured_at):
        instant=datetime.fromisoformat(captured_at)
        if instant.tzinfo is None:raise ValueError('IDENTITY_CAPTURE_TIMEZONE_MISSING')
        rows=list(rows)
        if len({r.physical_row_key for r in rows})!=len(rows) or any(not r.physical_row_key for r in rows):
            raise ValueError('IDENTITY_LOCATORS_INVALID')
        payload=sorted([(r.physical_row_key,signature(r),r.source_row_no,anchor(r)) for r in rows])
        digest=hashlib.sha256(encoded(payload).encode()).hexdigest()
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            existing=db.execute('SELECT * FROM snapshots WHERE snapshot_id=?',(snapshot_id,)).fetchone()
            if existing:
                if existing['digest']!=digest:
                    raise ValueError('IDENTITY_SNAPSHOT_MUTATION')
                if instant < datetime.fromisoformat(existing['captured_at']):
                    raise ValueError('IDENTITY_OUT_OF_ORDER_CAPTURE')
                # Evidence identity excludes acquisition time. Preserve the first
                # identity observation; ReportModel carries the latest read clock.
                return _project_result(db, json.loads(existing['result']), instant)
            previous=db.execute('SELECT * FROM snapshots ORDER BY seq DESC LIMIT 1').fetchone()
            if previous and instant < datetime.fromisoformat(previous['captured_at']):
                raise ValueError('IDENTITY_OUT_OF_ORDER_CAPTURE')
            old=_resolved_observations(db, db.execute('SELECT * FROM observations WHERE snapshot_id=?',
                (previous['snapshot_id'],)), instant) if previous else []
            by_signature=defaultdict(list)
            for r in old:by_signature[r['signature']].append(r)
            by_plan=defaultdict(list)
            for r in old:
                if r['plan_signature']:by_plan[r['plan_signature']].append(r)
            frequencies=Counter(signature(r) for r in rows)
            continuity_counts=Counter((continuity_signature(r), r.source_row_no) for r in rows)
            plan_frequencies=Counter(plan_signature(r) for r in rows)
            result=[];assigned=set()
            for row in sorted(rows,key=lambda r:r.physical_row_key):
                fp=signature(row);hits=by_signature[fp];uid=None
                candidates=sorted({r['uid'] for r in old if r['uid'] and r['source_id']==row.source_id
                    and ((row.source_row_no and r['business_id']==row.source_row_no) or r['anchor']==anchor(row))})
                evidence={'previous_snapshot_id':previous['snapshot_id'] if previous else None,
                          'signature':fp,'candidate_uids':candidates,'rule':'semantic-continuity-v2',
                          'continuity_signature':continuity_signature(row)}
                continuity_hits = [item for item in old if item['uid'] and row.source_row_no
                    and item['business_id'] == row.source_row_no
                    and json.loads(item['evidence']).get('continuity_signature') == continuity_signature(row)]
                if frequencies[fp]!=1:
                    status='AMBIGUOUS_DUPLICATE'
                elif len(hits)==1 and hits[0]['uid']:
                    uid=hits[0]['uid'];status='EXACT_CONTINUITY'
                    evidence['previous_locator']=hits[0]['locator']
                    evidence['review_ids']=json.loads(hits[0]['evidence']).get('review_ids', [])
                elif (len(continuity_hits) == 1 and continuity_counts[continuity_signature(row), row.source_row_no] == 1
                      and plan_frequencies[plan_signature(row)] == 1 and len(by_plan[plan_signature(row)]) == 1):
                    prior = continuity_hits[0]
                    uid=prior['uid'];status='OBSERVATION_CONTINUITY'
                    evidence['previous_locator']=prior['locator']
                    evidence['review_ids']=json.loads(prior['evidence']).get('review_ids', [])
                elif (plan_frequencies[plan_signature(row)] == 1
                      and len(by_plan[plan_signature(row)]) == 1
                      and by_plan[plan_signature(row)][0]['uid']
                      and row.source_row_no == by_plan[plan_signature(row)][0]['business_id']):
                    prior = by_plan[plan_signature(row)][0]
                    uid = prior['uid']; status = 'PLAN_CONTINUITY'
                    evidence.update(previous_locator=prior['locator'],
                                    plan_signature=plan_signature(row), rule='unique-plan-continuity-v1')
                elif hits or candidates:
                    status='REVIEW_REQUIRED'
                else:
                    uid='PUR-'+uuid.uuid4().hex;status='BASELINE_OBSERVATION' if not previous else 'FIRST_OBSERVATION'
                if uid and uid in assigned:raise ValueError('IDENTITY_UID_COLLISION')
                if uid:assigned.add(uid)
                item={'source_row_key':row.physical_row_key,'procurement_uid':uid,'status':status,'evidence':evidence}
                result.append(item)
                db.execute('''INSERT INTO observations
                    (snapshot_id,locator,signature,source_id,business_id,anchor,uid,status,evidence,plan_signature)
                    VALUES(?,?,?,?,?,?,?,?,?,?)''',
                    (snapshot_id,row.physical_row_key,fp,row.source_id,row.source_row_no,anchor(row),uid,status,
                     encoded(evidence),plan_signature(row)))
            missing=sorted({r['uid'] for r in old if r['uid']} - assigned)
            outcome={'snapshot_id':snapshot_id,'captured_at':captured_at,'rows':result,
                     'unresolved_count':sum(r['procurement_uid'] is None for r in result),
                     'absent_previous_uids':missing,'absence_meaning':'Not observed or not linked; fate unknown',
                     'scope':'Persisted observations from this baseline forward; historical recommendations are not proven by bootstrap.'}
            db.execute('INSERT INTO snapshots(snapshot_id,digest,captured_at,result) VALUES(?,?,?,?)',
                       (snapshot_id,digest,captured_at,encoded(outcome)))
            return outcome

    def record_review(self,*,snapshot_id,locator,uid,reviewer,reviewed_at,evidence):
        """Append review evidence. It never silently mutates the frozen import result.

        Later ingests consume a dated review projection; existing publication files
        and the stored raw snapshot result remain immutable.
        """
        if not reviewer or not evidence.get('source_ref') or not evidence.get('reason'):
            raise ValueError('IDENTITY_REVIEW_EVIDENCE_REQUIRED')
        moment=datetime.fromisoformat(reviewed_at)
        if moment.tzinfo is None:raise ValueError('IDENTITY_REVIEW_TIMEZONE_MISSING')
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT * FROM observations WHERE snapshot_id=? AND locator=?',(snapshot_id,locator)).fetchone()
            if row is None:raise ValueError('IDENTITY_REVIEW_ROW_UNKNOWN')
            observed=db.execute('SELECT captured_at FROM snapshots WHERE snapshot_id=?', (snapshot_id,)).fetchone()
            if moment < datetime.fromisoformat(observed['captured_at']):
                raise ValueError('IDENTITY_REVIEW_BEFORE_OBSERVATION')
            if not db.execute('SELECT 1 FROM observations WHERE uid=?',(uid,)).fetchone():
                raise ValueError('IDENTITY_REVIEW_UID_UNKNOWN')
            review_id='REV-'+uuid.uuid4().hex
            db.execute('INSERT INTO reviews VALUES(?,?,?,?,?,?,?)',
                       (review_id,snapshot_id,locator,uid,reviewer,reviewed_at,encoded(evidence)))
            return review_id

    def review_evidence(self, *, as_of=None):
        """Stable private proof input; observations themselves are output state."""
        with closing(self.connect()) as db:
            return [{**dict(item), 'evidence': json.loads(item['evidence'])}
                    for item in db.execute('SELECT * FROM reviews ORDER BY review_id')
                    if as_of is None or datetime.fromisoformat(item['reviewed_at']) <= datetime.fromisoformat(as_of)]

    def backup(self,destination):
        target=Path(destination)
        if target.exists():raise ValueError('IDENTITY_BACKUP_EXISTS')
        with closing(self.connect()) as source:
            _check_integrity(source)
            try:
                with closing(sqlite3.connect(target)) as dest:
                    source.backup(dest)
                    _check_integrity(dest)
            except (sqlite3.DatabaseError, ValueError):
                target.unlink(missing_ok=True)
                raise


def read_identity_result(path, snapshot_id, as_of):
    """Read the frozen SQLite backup without initializing or migrating it."""
    with closing(sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True)) as db:
        db.row_factory = sqlite3.Row
        _check_integrity(db)
        record = db.execute('SELECT result FROM snapshots WHERE snapshot_id=?', (snapshot_id,)).fetchone()
        if record is None:
            raise ValueError('IDENTITY_SNAPSHOT_UNKNOWN')
        return _project_result(db, json.loads(record['result']), datetime.fromisoformat(as_of))


def read_saved_identity(path, snapshot_id, *, as_of=None):
    """Read an independently frozen database without migrations or writes."""
    with closing(sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True)) as db:
        db.row_factory = sqlite3.Row
        _check_integrity(db)
        snapshot = db.execute('SELECT result FROM snapshots WHERE snapshot_id=?', (snapshot_id,)).fetchone()
        if snapshot is None:
            raise ValueError('IDENTITY_SNAPSHOT_EVIDENCE_MISSING')
        result = json.loads(snapshot['result'])
        observations = {r['locator']: r for r in db.execute(
            'SELECT * FROM observations WHERE snapshot_id=?', (snapshot_id,))}
        records = result.get('rows', [])
        if (result.get('snapshot_id') != snapshot_id or len(records) != len(observations)
            or len({r['source_row_key'] for r in records}) != len(records)):
            raise ValueError('IDENTITY_SNAPSHOT_EVIDENCE_INVALID')
        for record in records:
            row = observations.get(record['source_row_key'])
            if row is None or record != {'source_row_key': row['locator'], 'procurement_uid': row['uid'],
                'status': row['status'], 'evidence': json.loads(row['evidence'])}:
                raise ValueError('IDENTITY_SNAPSHOT_EVIDENCE_INVALID')
        if as_of is not None:
            instant = datetime.fromisoformat(as_of)
            if instant.tzinfo is None:
                raise ValueError('IDENTITY_CAPTURE_TIMEZONE_MISSING')
            return _project_result(db, result, instant)
        return result
