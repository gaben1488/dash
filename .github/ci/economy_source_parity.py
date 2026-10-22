"""Read-only C04.01 parity: one frozen source, TS calculator, report model and Word.

Default mode verifies 8 masters x 2 methods x 5 periods x 6 measures.
Acceptance mode additionally verifies the pinned dashboard, model and both
visible Word documents. No Google, production, or publisher writes.
"""
import argparse
import json
import os
import subprocess
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path

METRICS = ("plan_count", "fact_count", "plan_amount", "fact_amount",
           "confirmed_saving_amount", "execution_pct")
SCOPES = (("year", None), ("q1", 1), ("q2", 2), ("q3", 3), ("q4", 4))
METHODS = (("comp", "ЭА"), ("ep", "ЕП"))
TOLERANCE = Decimal("0.00000001")  # thousand RUB: 0.001 kopeck


def cells(block):
    exact = block["exact_decimal"]
    return (block["plan_count"], block["fact_count"], exact["plan_amount"],
            exact["fact_amount"], exact["confirmed_saving_amount"], block["execution_pct"])


def equal_cell(metric, expected, observed):
    if expected is None or observed is None:
        return expected is None and observed is None
    if isinstance(expected, bool) or isinstance(observed, bool):
        return False
    if metric in {"plan_count", "fact_count"}:
        return type(expected) is int and type(observed) is int and expected == observed
    try:
        left, right = Decimal(str(expected)), Decimal(str(observed))
        return left.is_finite() and right.is_finite() and abs(left - right) <= TOLERANCE
    except (InvalidOperation, ValueError, TypeError):
        return False


def differences(left, right):
    if not isinstance(left, (list, tuple)) or not isinstance(right, (list, tuple)):
        return list(METRICS)
    if len(left) != len(METRICS) or len(right) != len(METRICS):
        return list(METRICS)
    return [name for name, before, after in zip(METRICS, left, right, strict=True)
            if not equal_cell(name, before, after)]


def verify_views(manifest, model_path, dashboard_path, main_docx, management_docx,
                 expectations, all_rows):
    from procurement_engine.canonical_metrics import metric_block
    from procurement_engine.document_content import (
        planned_documents, validate_document_content, validate_document_plans,
    )
    from procurement_engine.normalize import parse_date

    model = json.loads(model_path.read_text(encoding="utf-8"))
    dashboard = json.loads(dashboard_path.read_text(encoding="utf-8"))
    stamp = model.get("snapshot") or {}
    as_of = parse_date(manifest["report_date"])
    if (stamp.get("snapshot_id") != manifest["snapshot_id"]
            or parse_date(stamp.get("report_date")) != as_of
            or stamp.get("report_year") != manifest["report_year"]
            or stamp.get("rules_version") != manifest.get("rules_version")):
        raise ValueError("ARTIFACT_SNAPSHOT_MISMATCH")
    if (dashboard.get("snapshot_id") != stamp["snapshot_id"]
            or parse_date(dashboard.get("report_date")) != as_of
            or dashboard.get("rules_version") != stamp.get("rules_version")
            or dashboard.get("headline") != model.get("headline")):
        raise ValueError("ARTIFACT_DASHBOARD_MISMATCH")

    content = model.get("report_content") or {}
    by_grbs = content.get("by_grbs") or {}
    grbs_by_source = {source["source_id"]: (source.get("payload_metadata") or {}).get("grbs")
                      for source in manifest["sources"] if source["role"] == "master"}
    if not all(grbs_by_source.values()) or set(by_grbs) != set(grbs_by_source.values()):
        raise ValueError("ARTIFACT_MASTER_SCOPE_MISMATCH")

    mismatches = []
    for (source, kind, scope), expected in expectations.items():
        grbs = grbs_by_source[source]
        block = by_grbs.get(grbs, {}).get(kind, {}).get(scope)
        bad = differences(expected, cells(block) if isinstance(block, dict) else [])
        mismatches.extend({"scope": "master", "method": kind, "period": scope, "metric": name}
                          for name in bad)
    global_blocks = content.get("global") or {}
    for kind, method in METHODS:
        for scope, quarter in SCOPES:
            reference = metric_block(all_rows, report_year=manifest["report_year"],
                                     as_of=as_of, method=method, planned_quarter=quarter)
            block = global_blocks.get(kind, {}).get(scope)
            bad = differences(cells(reference), cells(block) if isinstance(block, dict) else [])
            mismatches.extend({"scope": "global", "method": kind, "period": scope, "metric": name}
                              for name in bad)
    # The API/UI headline must agree with frozen source rows, not merely
    # agree with the copied dashboard JSON. Its quarter is the selected plan
    # quarter, which can differ from the as-of date's calendar quarter.
    headline = model.get("headline") or {}
    selected_quarter = headline.get("current_quarter")
    if type(selected_quarter) is not int or selected_quarter not in (1, 2, 3, 4):
        raise ValueError("ARTIFACT_HEADLINE_SCOPE_MISMATCH")
    for kind, method in METHODS:
        view = "competitive" if kind == "comp" else "single_supplier"
        for scope, quarter in (("year", None), ("quarter", selected_quarter)):
            reference = metric_block(all_rows, report_year=manifest["report_year"],
                                     as_of=as_of, method=method, planned_quarter=quarter)
            block = headline.get(view, {}).get(scope) or {}
            for metric in ("plan_count", "fact_count", "plan_amount", "fact_amount", "execution_pct"):
                expected_value = (reference["exact_decimal"][metric]
                                  if metric in {"plan_amount", "fact_amount"} else reference[metric])
                if not equal_cell(metric, expected_value, block.get(metric)):
                    mismatches.append({"scope": "headline", "method": kind,
                                       "period": scope, "metric": metric})
    if not validate_document_plans(model):
        raise ValueError("ARTIFACT_DOCUMENT_PLAN_MISMATCH")
    plans = planned_documents(model)
    validate_document_content(main_docx, plans["main"])
    validate_document_content(management_docx, plans["management"])
    return mismatches


def compare(bundle, repo, *, report_model=None, dashboard=None,
            main_docx=None, management_docx=None):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(repo / "packages/report-engine/src"))
    from procurement_engine.adapters import normalize_master_values
    from procurement_engine.canonical_metrics import metric_block
    from procurement_engine.normalize import parse_date
    from procurement_engine.snapshot_bundle_io import verify_persisted_bundle

    artifacts = (report_model, dashboard, main_docx, management_docx)
    if any(item is not None for item in artifacts) and not all(item is not None for item in artifacts):
        raise ValueError("ARTIFACT_SET_INCOMPLETE")
    if verify_persisted_bundle(bundle):
        raise ValueError("SOURCE_BUNDLE_INVALID")
    manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    as_of = parse_date(manifest["report_date"])
    if as_of is None:
        raise ValueError("SOURCE_DATE_INVALID")

    inputs, expected, rows_by_source = [], {}, {}
    for entry in manifest["payload_index"]:
        payload = json.loads((bundle / entry["path"]).read_text(encoding="utf-8"))
        if payload["role"] != "master":
            continue
        metadata, values = payload["metadata"], payload["semantic_values"]
        source = payload["source_id"]
        rows = normalize_master_values(
            values, snapshot_id=manifest["snapshot_id"], expected_grbs=metadata["grbs"],
            data_start_row=metadata["header_rows"], source_id=source,
        )
        rows_by_source[source] = rows
        inputs.append({"source": source, "values": values, "headers": metadata["header_rows"]})
        for kind, method in METHODS:
            for scope, quarter in SCOPES:
                block = metric_block(rows, report_year=manifest["report_year"],
                                     as_of=as_of, method=method, planned_quarter=quarter)
                expected[source, kind, scope] = cells(block)
    masters = {source["source_id"] for source in manifest["sources"]
               if source["role"] == "master"}
    if len(masters) != 8 or set(rows_by_source) != masters or len(inputs) != len(masters):
        raise ValueError("MASTER_SET_INCOMPLETE")

    # The renderer's frozen model and the UI's calculator see precisely these
    # captured values, not independently fetched or retimestamped Google rows.
    code = """
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const {CalcEngine,standardRowFilter,sliceResults}=await import(pathToFileURL(input.repo+'/packages/core/src/pipeline/calc-engine.ts').href);
const {dayNumberOf}=await import(pathToFileURL(input.repo+'/packages/shared/src/parse-sheet-date.ts').href);
const day=dayNumberOf(input.asOf);
if(day===null)throw Error('SOURCE_DATE_INVALID');
const methods=[['comp','competitive'],['ep','ep']];
const periods=[['year',null],['q1',1],['q2',2],['q3',3],['q4',4]];
const results=[];
for(const source of input.sources){
  const grouped=new CalcEngine().compute(source.values,standardRowFilter,source.headers,input.year,
    {asOfDay:day,strictYear:true});
  for(const [kind,method] of methods)for(const [scope,quarter] of periods){
    const filter=quarter===null?{methods:[method]}:{methods:[method],quarters:['q'+quarter]};
    const values=sliceResults(grouped,filter);
    const value=(key)=>values.get(key)?.value??0;
    const fraction=values.get('exec_count_pct')?.value??null;
    results.push({source:source.source,kind,scope,cells:[
      value('plan_count'),value('fact_count'),value('plan_total'),value('fact_total'),
      value('economy_total'),fraction===null?null:fraction*100]});
  }
}
console.log(JSON.stringify(results));
"""
    process = subprocess.run(
        ["node", "--import", "tsx", "--input-type=module", "-e", code],
        input=json.dumps({"sources": inputs, "year": manifest["report_year"],
                          "asOf": as_of, "repo": str(repo.resolve())}),
        text=True, capture_output=True, timeout=120, cwd=repo / "packages/server",
        env={**os.environ, "TSX_DISABLE_CACHE": "1"},
    )
    if process.returncode:
        raise ValueError("TS_COMPARISON_FAILED")
    actual = json.loads(process.stdout)
    found = set()
    mismatches = []
    for item in actual:
        key = (item["source"], item["kind"], item["scope"])
        if key not in expected or key in found:
            raise ValueError("TS_COMPARISON_SHAPE_MISMATCH")
        found.add(key)
        bad = differences(expected[key], item["cells"])
        mismatches.extend({"scope": "TS/Python", "method": key[1],
                           "period": key[2], "metric": name} for name in bad)
    if found != set(expected):
        raise ValueError("TS_COMPARISON_SHAPE_MISMATCH")

    acceptance = all(item is not None for item in artifacts)
    if acceptance:
        ordered_rows = [row for source in inputs for row in rows_by_source[source["source"]]]
        mismatches.extend(verify_views(manifest, *artifacts, expected, ordered_rows))
    return {
        "state": "PASS" if not mismatches else "MISMATCH",
        "scope": "FROZEN_TS_PYTHON_MODEL_DASHBOARD_WORD" if acceptance else "FROZEN_TS_PYTHON_ONLY",
        "snapshot_id": manifest["snapshot_id"], "report_year": manifest["report_year"],
        "as_of": as_of, "masters": len(masters),
        "ts_python_cells": len(expected) * len(METRICS),
        "model_cells": len(expected) * len(METRICS) + 2 * len(SCOPES) * len(METRICS) + 20 if acceptance else 0,
        "validated_word_documents": 2 if acceptance else 0,
        "mismatch_count": len(mismatches),
        "mismatches": mismatches[:30],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--report-model", type=Path)
    parser.add_argument("--dashboard", type=Path)
    parser.add_argument("--word-main", type=Path)
    parser.add_argument("--word-management", type=Path)
    args = parser.parse_args()
    try:
        evidence = compare(args.bundle, args.repo, report_model=args.report_model,
                           dashboard=args.dashboard, main_docx=args.word_main,
                           management_docx=args.word_management)
    except Exception as error:
        # Paths, sources, subprocess stderr and report text must not leak.
        allowed = {"SOURCE_BUNDLE_INVALID", "MASTER_SET_INCOMPLETE", "SOURCE_DATE_INVALID",
                   "TS_COMPARISON_FAILED", "TS_COMPARISON_SHAPE_MISMATCH",
                   "ARTIFACT_SET_INCOMPLETE", "ARTIFACT_SNAPSHOT_MISMATCH",
                   "ARTIFACT_DASHBOARD_MISMATCH", "ARTIFACT_MASTER_SCOPE_MISMATCH",
                   "ARTIFACT_DOCUMENT_PLAN_MISMATCH", "ARTIFACT_HEADLINE_SCOPE_MISMATCH"}
        print(json.dumps({"state": "PROBE_FAILED", "error_type": type(error).__name__,
                          "code": str(error) if str(error) in allowed else "INVALID_INPUT_OR_RUNTIME"}))
        raise SystemExit(2)
    print(json.dumps(evidence, ensure_ascii=False, allow_nan=False))
    raise SystemExit(0 if evidence["state"] == "PASS" else 2)
