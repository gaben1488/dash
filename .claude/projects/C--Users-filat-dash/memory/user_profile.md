---
name: user_profile
description: User role, expertise, communication style, and expectations for AEMR project collaboration
type: user
---

## Role
- Municipal government procurement analytics lead / product owner
- Deep domain knowledge in Russian public procurement (44-ФЗ, 223-ФЗ)
- Understands data structures of СВОД ТД-ПМ and department spreadsheets intimately
- Knows exact cell addresses, column meanings, sheet naming conventions

## Communication Style
- Writes long, dense messages mixing requirements, feedback, and architectural direction
- Uses "и тд" to mean "continue reasoning yourself, don't just stop at what I listed"
- Expects proactive thinking — fill in the gaps, don't ask obvious questions
- Wants to see proof things work, not just code changes
- Prefers Russian for UI/domain terms, tolerates English for technical concepts

## Expectations
- Act as team lead, not junior developer — plan, delegate, architect
- Use parallel agents for speed
- Don't make point fixes — do comprehensive restructuring when system is broken
- Every analytical element must be drillable to source data
- All filters must work end-to-end across every widget
- No dead code, no placeholders, no "TODO" stubs in production paths
- Verify changes actually work, don't just claim they compile

## Technical Knowledge
- Understands spreadsheet formulas (COUNTIFS, SUMIFS)
- Knows Google Sheets API structure
- Can read TypeScript/React code
- Previously built v22-v27 with GPT (v26 = stable, v27 = regression)
