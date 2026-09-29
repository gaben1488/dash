from __future__ import annotations

GRBS_ORDER = ["УЭР", "УИО", "УАГЗО", "УФБП", "УД", "УДТХ", "УКСиМП", "УО"]

ROW_MAPPING = {
    "A": "source_row_no", "B": "grbs", "C": "institution", "D": "program",
    "E": "subprogram", "F": "activity_kind", "G": "subject", "H": "plan_fb",
    "I": "plan_kb", "J": "plan_mb", "K": "plan_total", "L": "method",
    "M": "single_supplier_reason", "N": "planned_date", "O": "planned_quarter",
    "P": "planned_year", "Q": "actual_date", "R": "actual_quarter",
    "S": "actual_year", "T": "deviation", "U": "deviation_reason",
    "V": "fact_fb", "W": "fact_kb", "X": "fact_mb", "Y": "fact_total",
    "Z": "saving_fb", "AA": "saving_kb", "AB": "saving_mb", "AC": "saving_total",
    "AD": "include_saving", "AE": "necessity_reason", "AF": "grbs_comment",
    "AG": "uer_comment_or_procedure_code", "AH": "monitoring_note",
}

ACTIVE_RECOMMENDATION_STATUSES = {
    "OPEN", "ACCEPTED_PENDING", "IMPLEMENTED", "IMPLEMENTED_AND_COMPLETED",
    "PARTIALLY_IMPLEMENTED", "NOT_IMPLEMENTED", "CONTRACTED_EP", "MERGED",
    "REMOVED_FROM_PLAN", "CANCELLED_NO_FINANCING", "POSTPONED", "MOVED_TO_2027",
    "PROCEDURE_FAILED", "REPROCURED",
}

ALL_RECOMMENDATION_STATUSES = ACTIVE_RECOMMENDATION_STATUSES | {"SUPERSEDED"}

COMPLETED_PROCEDURE_STATES = {
    "PROCEDURE_COMPLETED", "MERGED_PROCEDURE_COMPLETED", "REPROCURED_AND_COMPLETED"
}

FACT_STATES = {"FACT_RECORDED", "GROUP_WITH_FACT"} | COMPLETED_PROCEDURE_STATES
