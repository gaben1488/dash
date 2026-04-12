---
name: feedback_v15
description: User feedback after Plan v15 — code is broken, needs full audit not point fixes, massive restructuring required
type: feedback
---

Don't do point fixes — do massive restructuring when the system is fundamentally broken.

**Why:** User says "код сломан и почти ничего не работает". Point fixes across sessions created illusion of progress but the system doesn't actually work end-to-end.

**How to apply:** Before any code changes, do a complete audit of all code from A to Z. Build ideal target model first. Compare against reality. Then execute a comprehensive roadmap, not incremental patches.

Key principles:
1. Analyze conversation context and all source data holistically
2. Build ideal model of how it SHOULD work
3. Audit ALL existing code to understand what it ACTUALLY does
4. Compare ideal vs actual — find ALL gaps, not just obvious ones
5. Execute broad restructuring, not point fixes
6. Don't lose data between parsing and analytics modules
7. Every metric/cell should be drillable to source with edit capability
8. Export capability for problem reports
