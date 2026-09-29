"""Canonical procurement reporting domain engine.

Core calculations consume frozen data. Google acquisition and DOCX rendering
are explicit adapters; published projections share one ReportModel.
"""

__version__ = "1.5.0rc6"
RULES_VERSION = "procurement-rules-v1.1.0"
RECOMMENDATION_RULES_VERSION = "recommendations-v2.0.0"
SNAPSHOT_CONTRACT_VERSION = "snapshot-v2.2.0"
REPORT_MODEL_VERSION = "report-model-v1.2.0"

from .input_contract import summarize_input_contract as summarize_input_contract
from .input_contract import validate_input_contract as validate_input_contract
