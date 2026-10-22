#!/usr/bin/env python3
"""Isolated C08.14 SQLite/PostgreSQL comparison. Never connects to live Dash.

Postgres safety: PGDATABASE must equal 'bench_c08_14'; the only created objects
are a unique bench_c08_14_* schema and a temporary bench_c08_14_restore_* DB.
No Google, production volumes, Dash imports, or secrets are read.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import resource
import sqlite3
import statistics
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor


def percentile(values: list[float], p: float) -> float:
    if not values:
        raise ValueError("no observations")
    return sorted(values)[max(0, math.ceil(len(values) * p) - 1)]


def new_payload(index: int, kib: int) -> str:
    # High-entropy JSON value, rather than a highly compressible repeated string.
    content = hashlib.shake_256(f"c08.14:{index}".encode()).hexdigest(max(1, (kib * 1024 - 12) // 2))
    return json.dumps({"raw": content}, separators=(",", ":"))


class Pilot:
    def __init__(self, engine: str, location: str, prefix: str):
        self.engine, self.location, self.prefix = engine, location, prefix

    def table(self, short: str) -> str:
        if short not in {"snapshots", "issues", "queue"}:
            raise ValueError("invalid table")
        return f"{self.prefix}{short}" if self.engine == "sqlite" else f"{self.prefix}.{short}"

    def connect(self):
        if self.engine == "sqlite":
            db = sqlite3.connect(self.location, timeout=5, isolation_level=None)
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("PRAGMA synchronous=NORMAL")
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("PRAGMA busy_timeout=5000")
            return db
        import psycopg  # Optional; installed only in PostgreSQL CI pilot.
        return psycopg.connect(dbname=self.location, autocommit=True)

    def sql(self, statement: str) -> str:
        return statement if self.engine == "sqlite" else statement.replace("?", "%s")

    def execute(self, db, statement: str, params=()):
        return db.execute(self.sql(statement), params)

    def initialize(self):
        with self.connect() as db:
            if self.engine == "postgres":
                self.execute(db, f"CREATE SCHEMA {self.prefix}")
            self.execute(db, f"CREATE TABLE {self.table('snapshots')} (id TEXT PRIMARY KEY, spreadsheet_id TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL)")
            self.execute(db, f"CREATE INDEX {self.prefix.replace('.', '_')}_snap_scope ON {self.table('snapshots')} (spreadsheet_id, created_at DESC, id DESC)")
            self.execute(db, f"CREATE TABLE {self.table('issues')} (id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, status TEXT NOT NULL, detected_at TEXT NOT NULL)")
            self.execute(db, f"CREATE INDEX {self.prefix.replace('.', '_')}_issues_status ON {self.table('issues')} (status, detected_at DESC, id DESC)")
            self.execute(db, f"CREATE TABLE {self.table('queue')} (id INTEGER PRIMARY KEY, book TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL)")
            self.execute(db, f"CREATE INDEX {self.prefix.replace('.', '_')}_queue_pending ON {self.table('queue')} (state, id)")

    def seed(self, n_snapshots: int, n_issues: int, n_queue: int, payload_kib: int):
        with self.connect() as db:
            if self.engine == "sqlite":
                db.execute("BEGIN")
            else:
                db.execute("BEGIN")
            try:
                for i in range(n_snapshots):
                    self.execute(db, f"INSERT INTO {self.table('snapshots')} VALUES (?,?,?,?)", (f"snap-{i:05d}", "УО" if i % 2 else "УД", f"2026-10-{(i%25)+1:02d}T00:00:00Z", new_payload(i, payload_kib)))
                for i in range(n_issues):
                    self.execute(db, f"INSERT INTO {self.table('issues')} VALUES (?,?,?,?)", (f"issue-{i:06d}", f"snap-{i%n_snapshots:05d}", "open" if i%3 else "resolved", f"2026-10-{(i%25)+1:02d}T00:00:00Z"))
                for i in range(n_queue):
                    self.execute(db, f"INSERT INTO {self.table('queue')} VALUES (?,?,?,?)", (i+1, "УО", "pending" if i%4 else "done", 0))
                db.execute("COMMIT")
            except BaseException:
                db.execute("ROLLBACK")
                raise

    def fingerprint(self, db) -> str:
        """Full content parity, not just row counts or lossy spot checks."""
        digest = hashlib.sha256()
        for name, order in (("snapshots", "id"), ("issues", "id"), ("queue", "id")):
            cursor = self.execute(db, f"SELECT * FROM {self.table(name)} ORDER BY {order}")
            for row in cursor:
                digest.update(json.dumps(row, ensure_ascii=False, separators=(",", ":")).encode())
                digest.update(b"\n")
        return digest.hexdigest()

    def operation(self, db, kind: str, i: int):
        if kind == "latest_head":
            return self.execute(db, f"SELECT id,created_at FROM {self.table('snapshots')} WHERE spreadsheet_id=? ORDER BY created_at DESC,id DESC LIMIT 1", ("УД" if i%2 else "УО",)).fetchall()
        if kind == "issue_page":
            return self.execute(db, f"SELECT id,status FROM {self.table('issues')} WHERE status=? ORDER BY detected_at DESC,id DESC LIMIT 50 OFFSET ?", ("open", (i%4)*50)).fetchall()
        if kind == "payload_detail":
            return self.execute(db, f"SELECT data FROM {self.table('snapshots')} WHERE id=?", (f"snap-{i%self.n_snapshots:05d}",)).fetchone()
        if kind == "queue_poll":
            return self.execute(db, f"SELECT id FROM {self.table('queue')} WHERE state=? ORDER BY id LIMIT 20", ("pending",)).fetchall()
        if kind == "writer_ack":
            return self.execute(db, f"UPDATE {self.table('queue')} SET state=?,attempts=attempts+1 WHERE id=?", ("done", i%self.n_queue+1)).rowcount
        raise ValueError(kind)

    def timed_series(self, kind: str, requests: int) -> dict:
        with self.connect() as db:
            timings=[]
            for i in range(requests):
                start=time.perf_counter_ns()
                self.operation(db,kind,i)
                timings.append((time.perf_counter_ns()-start)/1e6)
        return {"count":len(timings),"p50_ms":round(statistics.median(timings),3),"p95_ms":round(percentile(timings,.95),3),"max_ms":round(max(timings),3)}

    def concurrency(self, readers: int, reads_per_reader: int, writes: int) -> dict:
        barrier=threading.Barrier(readers+1)
        errors=[]
        latencies=[]
        lock=threading.Lock()
        def reader(worker_id: int):
            with self.connect() as db:
                barrier.wait(timeout=20)
                local=[]
                for i in range(reads_per_reader):
                    start=time.perf_counter_ns()
                    try:
                        self.operation(db, "issue_page" if i%2 else "latest_head", i+worker_id)
                        local.append((time.perf_counter_ns()-start)/1e6)
                    except Exception as exc:
                        with lock:
                            errors.append(type(exc).__name__)
                with lock:
                    latencies.extend(local)
        def writer():
            with self.connect() as db:
                barrier.wait(timeout=20)
                for i in range(writes):
                    try:
                        self.operation(db,"writer_ack",i)
                    except Exception as exc:
                        with lock:
                            errors.append(type(exc).__name__)
        start=time.monotonic()
        with ThreadPoolExecutor(max_workers=readers+1) as pool:
            tasks=[pool.submit(reader,j) for j in range(readers)]+[pool.submit(writer)]
            for task in tasks:
                task.result(timeout=90)
        return {"readers":readers,"reads":len(latencies),"writes":writes,"wall_ms":round((time.monotonic()-start)*1000,3),"p95_read_ms":round(percentile(latencies,.95),3) if latencies else None,"errors":len(errors),"error_types":sorted(set(errors))}

    def storage_bytes(self) -> int:
        if self.engine == "sqlite":
            return sum(Path(self.location+x).stat().st_size for x in ("", "-wal", "-shm") if Path(self.location+x).exists())
        with self.connect() as db:
            vals=self.execute(db,"SELECT coalesce(sum(pg_total_relation_size(c.oid)),0) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=? AND c.relkind IN ('r','m')",(self.prefix,)).fetchone()
            return int(vals[0])

    def verify_restore(self, scratch: Path) -> dict:
        with self.connect() as db:
            expected=self.fingerprint(db)
        if self.engine == "sqlite":
            restored=scratch/"sqlite-restored.db"
            with self.connect() as src, sqlite3.connect(restored) as dst:
                src.backup(dst)
            copy=Pilot("sqlite",str(restored),self.prefix)
            with copy.connect() as db:
                actual=copy.fingerprint(db)
            size=restored.stat().st_size
        else:
            restore_db=f"bench_c08_14_restore_{uuid.uuid4().hex[:12]}"
            dump=scratch/"pg-copy.dump"
            # pg_dump and pg_restore run against isolated PostgreSQL only.
            # Do not include raw stderr: libpq may print connection metadata.
            subprocess.run(["pg_dump","--format=custom","--no-owner","--no-acl","--schema",self.prefix,"--file",str(dump),"--dbname",self.location],check=True,capture_output=True,timeout=120)
            size=dump.stat().st_size
            import psycopg
            with psycopg.connect(dbname="postgres",autocommit=True) as admin:
                admin.execute(f"CREATE DATABASE {restore_db}")
            try:
                subprocess.run(["pg_restore","--exit-on-error","--no-owner","--no-acl","--dbname",restore_db,str(dump)],check=True,capture_output=True,timeout=120)
                copy=Pilot("postgres",restore_db,self.prefix)
                with copy.connect() as db:
                    actual=copy.fingerprint(db)
            finally:
                with psycopg.connect(dbname="postgres",autocommit=True) as admin:
                    admin.execute(f"DROP DATABASE {restore_db} WITH (FORCE)")
        if actual!=expected:
            raise AssertionError("restore content mismatch")
        return {"full_content_sha256_matches":True,"backup_bytes":size}

    def cleanup(self):
        if self.engine=="postgres":
            with self.connect() as db:
                self.execute(db,f"DROP SCHEMA IF EXISTS {self.prefix} CASCADE")


def run_one(engine: str, args, scratch: Path) -> dict:
    if engine == "postgres":
        if os.getenv("PGDATABASE")!="bench_c08_14":
            raise RuntimeError("PostgreSQL target must be the dedicated bench_c08_14 database")
        prefix=f"bench_c08_14_{uuid.uuid4().hex[:12]}"
        location="bench_c08_14"
    else:
        prefix="bench_"
        location=str(scratch/"work.db")
    pilot=Pilot(engine,location,prefix)
    pilot.n_snapshots,pilot.n_queue=args.snapshots,args.queue
    try:
        pilot.initialize()
        pilot.seed(args.snapshots,args.issues,args.queue,args.payload_kib)
        with pilot.connect() as db:
            initial=pilot.fingerprint(db)
        timings={k:pilot.timed_series(k,args.requests) for k in ("latest_head","issue_page","payload_detail","queue_poll")}
        concurrent=pilot.concurrency(args.readers,args.reads_per_reader,args.writes)
        if concurrent["errors"]:
            raise RuntimeError(f"concurrent operations failed ({concurrent['errors']} errors)")
        with pilot.connect() as db:
            after_write=pilot.fingerprint(db)
        restore=pilot.verify_restore(scratch)
        return {"engine":engine,"data_contract_sha256":initial,"post_write_contract_sha256":after_write,"workload":timings,"concurrency":concurrent,"restored":restore,"storage_bytes":pilot.storage_bytes(),"peak_process_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}
    finally:
        pilot.cleanup()


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine",choices=("sqlite","postgres"),required=True)
    parser.add_argument("--snapshots",type=int,default=17)
    parser.add_argument("--issues",type=int,default=3000)
    parser.add_argument("--queue",type=int,default=300)
    parser.add_argument("--payload-kib",type=int,default=1024)
    parser.add_argument("--requests",type=int,default=80)
    parser.add_argument("--readers",type=int,default=8)
    parser.add_argument("--reads-per-reader",type=int,default=30)
    parser.add_argument("--writes",type=int,default=60)
    parser.add_argument("--output",type=Path)
    a=parser.parse_args()
    if not all(getattr(a,k)>0 for k in ("snapshots","issues","queue","payload_kib","requests","readers","reads_per_reader","writes")):
        parser.error("all workload dimensions must be positive")
    if a.snapshots>100 or a.payload_kib>32768 or a.issues>100_000 or a.readers>32:
        parser.error("pilot workload exceeds safety cap")
    with tempfile.TemporaryDirectory(prefix="c08-14-pilot-") as folder:
        result={"pilot":"C08.14","sample":"synthetic-not-live","seed":"sha256-shake256-v1","parameters":{k:getattr(a,k) for k in ("snapshots","issues","queue","payload_kib","requests","readers","reads_per_reader","writes")},"result":run_one(a.engine,a,Path(folder))}
    output=json.dumps(result,ensure_ascii=False,indent=2)+"\n"
    if a.output:
        a.output.parent.mkdir(parents=True,exist_ok=True)
        a.output.write_text(output,encoding="utf-8")
    else:
        print(output,end="")


if __name__=="__main__":
    main()
