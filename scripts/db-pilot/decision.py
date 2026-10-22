#!/usr/bin/env python3
"""Fail-closed comparability gate; results do not authorize a DB migration."""
from __future__ import annotations
import argparse
import json
from pathlib import Path


def compare(sqlite_doc: dict, pg_doc: dict) -> dict:
    for name,doc,engine in (("sqlite",sqlite_doc,"sqlite"),("postgres",pg_doc,"postgres")):
        if doc.get("pilot")!="C08.14" or doc.get("sample")!="synthetic-not-live" or doc.get("result",{}).get("engine")!=engine:
            raise ValueError(f"untrusted {name} pilot result")
        if doc["result"].get("restored",{}).get("full_content_sha256_matches") is not True:
            raise ValueError(f"{name} restore not verified")
        if doc["result"].get("concurrency",{}).get("errors")!=0:
            raise ValueError(f"{name} concurrency failures")
    if sqlite_doc["parameters"]!=pg_doc["parameters"] or sqlite_doc["seed"]!=pg_doc["seed"]:
        raise ValueError("non-comparable workload parameters")
    if sqlite_doc["result"]["data_contract_sha256"]!=pg_doc["result"]["data_contract_sha256"]:
        raise ValueError("seeded data differs between engines")
    if sqlite_doc["result"].get("post_write_contract_sha256")!=pg_doc["result"].get("post_write_contract_sha256"):
        raise ValueError("concurrent write results differ between engines")
    return {
        "pilot":"C08.14",
        "gate":"PASS_SYNTHETIC_ONLY",
        "production_approved":False,
        "migration_approved":False,
        "workload":sqlite_doc["parameters"],
        "same_full_seed_sha256":True,
        "measurements":{
            engine:{
                "p95_ms":{kind:doc["result"]["workload"][kind]["p95_ms"] for kind in ("latest_head","issue_page","payload_detail","queue_poll")},
                "concurrent_read_p95_ms":doc["result"]["concurrency"]["p95_read_ms"],
                "concurrent_wall_ms":doc["result"]["concurrency"]["wall_ms"],
                "storage_bytes":doc["result"]["storage_bytes"],
                "backup_bytes":doc["result"]["restored"]["backup_bytes"],
                "peak_process_rss_kib":doc["result"]["peak_process_rss_kib"],
            } for engine,doc in (("sqlite",sqlite_doc),("postgres",pg_doc))
        },
        "limits":["Python sqlite3 vs psycopg driver overhead is not Node better-sqlite3 latency", "GitHub-hosted runner is not the production VPS", "Fixtures model read/query patterns but contain no production data", "No full PostgreSQL application migration or image+data rollback trial"],
        "recommendation":"Retain current SQLite WAL until a like-for-like isolated real-data replay and rollback proof justify changing it"
    }


def main() -> None:
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("sqlite",type=Path)
    p.add_argument("postgres",type=Path)
    p.add_argument("--output",type=Path,required=True)
    args=p.parse_args()
    outcome=compare(json.loads(args.sqlite.read_text()),json.loads(args.postgres.read_text()))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(outcome,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print("C08.14 synthetic parity, concurrency and independent restore verified; PRODUCTION GATE STILL OPEN")

if __name__=="__main__":
    main()
