from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from .normalize import clean_text

if TYPE_CHECKING:
    from .models import ProcurementRow


@dataclass(frozen=True)
class RuleCatalog:
    """Single versioned home for core procurement inclusion/method rules.

    Public compatibility wrappers in ``normalize`` and ``fact_model`` delegate here,
    so production, QA and projection code cannot silently drift by copying predicates.
    """

    version: str = "procurement-rules-v1.1.0"
    competitive_exact: frozenset[str] = frozenset({"ЭА", "ЭК", "ЭЗК", "ЭП", "ЭАС"})

    # Procedure-binding thresholds are part of the versioned rule contract.
    explicit_exact_amount_diff: float = 0.005
    explicit_exact_subject_similarity: float = 0.25
    explicit_compatible_amount_diff: float = 0.03
    explicit_strong_subject_similarity: float = 0.65
    inferred_exact_amount_diff: float = 0.001
    inferred_strong_subject_similarity: float = 0.55
    inferred_compatible_amount_diff: float = 0.005
    inferred_compatible_subject_similarity: float = 0.30
    procedure_subject_similarity_threshold: float = 0.45

    def normalize_grbs(self, value) -> str | None:
        text = clean_text(value).upper().replace("Ё", "Е")
        if not text:
            return None
        compact = re.sub(r"[^А-ЯA-Z0-9]", "", text)
        exact = {
            "УЭР": "УЭР", "УИО": "УИО", "УАГЗО": "УАГЗО", "УАГИЗО": "УАГЗО",
            "УФБП": "УФБП", "УД": "УД", "УДТХ": "УДТХ", "УДТХИРКИ": "УДТХ",
            "УКСИМП": "УКСиМП", "УО": "УО",
        }
        if compact in exact:
            return exact[compact]
        aliases = (
            (("УПРАВЛЕНИЕ ОБРАЗОВАН",), "УО"),
            (("ДОРОЖНО-ТРАНСПОРТ", "УДТХ"), "УДТХ"),
            (("КУЛЬТУР", "СПОРТ", "МОЛОДЕЖ"), "УКСиМП"),
            (("УПРАВЛЕНИЕ ИМУЩ", "УИО"), "УИО"),
            (("ФИНАНСОВО-БЮДЖЕТ", "УФБП"), "УФБП"),
            (("ГРАДОСТРО", "ЗЕМЕЛ", "УАГЗО", "УАГИЗО"), "УАГЗО"),
            (("ЭКОНОМИЧЕСКОГО РАЗВИТ", "УЭР"), "УЭР"),
            (("УПРАВЛЕНИЕ ДЕЛАМИ",), "УД"),
        )
        for tokens, canonical in aliases:
            if any(token in text for token in tokens):
                return canonical
        return None

    def normalize_procedure_code(self, value) -> str | None:
        text = clean_text(value).upper().replace("E", "Е").replace("Ё", "Е")
        if not text:
            return None
        match = re.fullmatch(r"Э[А-ЯA-Z]{0,3}\d+(?:/\d+)?-\d{2}", text)
        return match.group(0) if match else None

    def normalize_method(self, value) -> str | None:
        text = clean_text(value).upper().replace("E", "Е").replace("Ё", "Е")
        if not text:
            return None
        compact = re.sub(r"[^А-ЯA-Z0-9]", "", text)
        if compact == "ЕП" or "ЕДИНСТВ" in text:
            return "ЕП"
        if compact in self.competitive_exact or any(
            token in text for token in ("АУКЦ", "КОНКУР", "ЗАПРОС КОТИРОВОК")
        ):
            return "ЭА"
        return None

    def is_procurement_row(self, row: ProcurementRow, *, report_year: int | None = None) -> bool:
        """Canonical F+recognized L+valid N+P projection predicate.

        A/source_row_no and B/grbs text are deliberately not row-existence gates.
        ``row.method`` must already be normalized by this same catalog, so an unknown
        source method becomes ``None`` and fails closed.
        """
        if not row.subject or not row.activity_kind or not row.method or not row.planned_date or row.planned_year is None:
            return False
        if row.method not in {"ЕП", "ЭА"}:
            return False
        return not (report_year is not None and row.planned_year != report_year)


DEFAULT_RULE_CATALOG = RuleCatalog()
