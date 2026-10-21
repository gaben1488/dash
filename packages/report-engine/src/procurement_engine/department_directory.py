"""Shared department identities and reviewed names, consumed by Python and TypeScript."""
from __future__ import annotations

import json
import re
import unicodedata
from importlib.resources import files

_DIRECTORY = json.loads(files(__package__).joinpath("department_directory.json").read_text(encoding="utf-8"))
if _DIRECTORY.get("version") != 1:
    raise ValueError("DEPARTMENT_DIRECTORY_VERSION")
DEPARTMENTS = tuple(_DIRECTORY["departments"])
_BY_ID = {entry["id"]: entry for entry in DEPARTMENTS}
if len(_BY_ID) != len(DEPARTMENTS):
    raise ValueError("DEPARTMENT_DIRECTORY_DUPLICATE_ID")


def _alias_key(value: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value).strip()).upper().replace("Ё", "Е")


ALIASES: dict[str, str] = {}
for alias, canonical in [
    *_DIRECTORY["aliases"].items(),
    *((entry[field], entry["id"]) for entry in DEPARTMENTS
      for field in ("id", "latinId", "shortName", "fullName")),
]:
    key = _alias_key(alias)
    if canonical not in _BY_ID or (key in ALIASES and ALIASES[key] != canonical):
        raise ValueError(f"DEPARTMENT_ALIAS_CONFLICT: {alias}")
    ALIASES[key] = canonical


def department_id(value) -> str | None:
    return ALIASES.get(_alias_key(str(value))) if value is not None else None


def department_label(value: str) -> str:
    canonical = department_id(value)
    return _BY_ID[canonical]["shortName"] if canonical else value


APPROVED_PRIMARY_TITLE_ALIASES = {
    (entry["approvedPrimaryRename"]["providerId"], entry["approvedPrimaryRename"]["sheetId"], entry["sheetName"]): entry["shortName"]
    for entry in DEPARTMENTS if "approvedPrimaryRename" in entry
}
