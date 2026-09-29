from __future__ import annotations

from pathlib import Path


class RendererInputError(RuntimeError):
    pass


def assert_renderer_inputs(*, report_model: dict, input_files: list[str] | None = None) -> None:
    """Renderer must consume ReportModel only; previous reports may be style templates, never data sources."""
    if not isinstance(report_model, dict):
        raise RendererInputError("REPORT_MODEL_REQUIRED")
    report_date = report_model.get("report_date")
    if not report_date and isinstance(report_model.get("snapshot"), dict):
        report_date = report_model["snapshot"].get("report_date")
    if not report_date:
        raise RendererInputError("REPORT_MODEL_REQUIRED")
    for raw in input_files or []:
        p = Path(raw)
        if p.suffix.lower() == ".docx" and any(x in p.name.casefold() for x in ("отчет", "report")):
            raise RendererInputError(f"PREVIOUS_REPORT_AS_DATA_FORBIDDEN: {p.name}")


def assert_no_global_date_rewrite(replacements: list[tuple[str, str]]) -> None:
    """Dates inside evidence are immutable. Renderer may only fill named/as-of placeholders."""
    for old, new in replacements:
        if old != new and any(ch.isdigit() for ch in old):
            raise RendererInputError("GLOBAL_DATE_REWRITE_FORBIDDEN")
