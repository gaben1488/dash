"""
sync_impeccable_v3.py — обновить наши 18 split-skills impeccable из upstream v3.0.7
+ создать 6 новых (craft, teach, document, extract, onboard, live).

Stratégie:
1. Скопировать встроенный master `.claude/skills/impeccable/` целиком в ~/.claude/skills/impeccable/ (НОВЫЙ master).
2. Для каждого split impeccable-* — прочитать reference/<cmd>.md, обернуть frontmatter, заменить {{command_prefix}} → /, записать.
3. Создать 6 новых split-скиллов: craft, teach, document, extract, onboard, live.

Usage: python scripts/sync_impeccable_v3.py [--dry-run]
"""
import sys, re, shutil, json
from pathlib import Path
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

UPSTREAM = Path(r'C:\Users\filat\AppData\Local\Temp\skill-updates\impeccable')
LOCAL_SKILLS = Path(r'C:\Users\filat\.claude\skills')
DRY = '--dry-run' in sys.argv

# Mapping cmd → frontmatter description (taken from upstream master)
CMD_DESCRIPTIONS = {
    'shape': 'Plan the UX and UI for a feature before writing code. Runs a structured discovery interview, then produces a design brief that guides implementation.',
    'craft': 'Shape, then build a feature end-to-end. Runs the full design+implementation cycle: discovery brief, design brief, then production code with all gates.',
    'teach': 'Set up PRODUCT.md and DESIGN.md context files for the project. Bootstrapping ritual run once before any other impeccable command.',
    'document': 'Generate DESIGN.md from existing project code. Reverse-engineers design system, tokens, components, and conventions from a codebase.',
    'extract': 'Pull reusable tokens and components into a design system. Identifies recurring patterns and promotes them to canonical primitives.',
    'critique': 'Evaluate design from a UX perspective with heuristic scoring. Assesses visual hierarchy, information architecture, emotional resonance, cognitive load.',
    'audit': 'Run technical quality checks across accessibility, performance, theming, responsive design, and anti-patterns. Generates a scored report with P0/P1/P2 issues.',
    'polish': 'Performs a final quality pass fixing alignment, spacing, consistency, and micro-detail issues before shipping.',
    'bolder': 'Amplify safe or boring designs to make them more visually interesting and stimulating. Increases impact while maintaining usability.',
    'quieter': 'Tones down visually aggressive or overstimulating designs, reducing intensity while preserving quality.',
    'distill': 'Strip designs to their essence by removing unnecessary complexity. Great design is simple, powerful, and clean.',
    'harden': 'Strengthen interfaces against edge cases, errors, internationalization issues, and real-world usage.',
    'onboard': 'Design first-run flows, empty states, and activation experiences that make new users productive quickly.',
    'animate': 'Review a feature and enhance it with purposeful animations, micro-interactions, and motion effects that improve usability and delight.',
    'colorize': 'Add strategic color to features that are too monochromatic or lack visual interest, making interfaces more engaging and expressive.',
    'typeset': 'Improves typography by fixing font choices, hierarchy, sizing, weight, and readability so text feels intentional.',
    'layout': 'Improve layout, spacing, and visual rhythm. Fixes monotonous grids, inconsistent spacing, and weak visual hierarchy.',
    'delight': 'Add moments of joy, personality, and unexpected touches that make interfaces memorable and enjoyable to use.',
    'overdrive': 'Pushes interfaces past conventional limits with technically ambitious implementations.',
    'clarify': 'Improve unclear UX copy, error messages, microcopy, labels, and instructions to make interfaces easier to understand.',
    'adapt': 'Adapt designs to work across different screen sizes, devices, contexts, or platforms.',
    'optimize': 'Diagnoses and fixes UI performance across loading speed, rendering, animations, images, and bundle size.',
    'live': 'Visual variant mode: pick elements in the browser, generate alternatives, iterate live.',
    'impeccable': 'Master skill — main router. Use when the user wants to design, redesign, shape, critique, audit, polish, clarify, distill, harden, optimize, adapt, animate, colorize, extract, or otherwise improve a frontend interface.',
}

CMD_ARG_HINTS = {
    'shape': '[feature to shape]',
    'craft': '[feature to craft]',
    'teach': '',
    'document': '[scope or path]',
    'extract': '[target component or pattern]',
    'critique': '[target]',
    'audit': '[target]',
    'polish': '[target]',
    'bolder': '[target]',
    'quieter': '[target]',
    'distill': '[target]',
    'harden': '[target]',
    'onboard': '[target]',
    'animate': '[target]',
    'colorize': '[target]',
    'typeset': '[target]',
    'layout': '[target]',
    'delight': '[target]',
    'overdrive': '[target]',
    'clarify': '[target]',
    'adapt': '[target]',
    'optimize': '[target]',
    'live': '',
}

VERSION = '3.0.7'

def transform_content(content):
    """Substitute {{command_prefix}} → /, {{ask_instruction}} → 'Ask the user directly.'"""
    content = content.replace('{{command_prefix}}', '/')
    content = content.replace('{{ask_instruction}}', 'Ask the user directly to clarify what you cannot infer.')
    content = content.replace('{{scripts_path}}', '~/.claude/skills/impeccable/scripts')
    return content

def build_skill_md(cmd, ref_content):
    """Build SKILL.md with frontmatter + transformed content."""
    desc = CMD_DESCRIPTIONS.get(cmd, f'impeccable {cmd} command')
    arg_hint = CMD_ARG_HINTS.get(cmd, '[target]')
    arg_yaml = f'argument-hint: "{arg_hint}"' if arg_hint else ''

    fm = f"""---
name: {cmd}
description: {desc}
version: {VERSION}
user-invocable: true
{arg_yaml}
---
"""
    body = "## MANDATORY PREPARATION\n\nInvoke /impeccable, which contains design principles, anti-patterns, and the **Context Gathering Protocol**. Follow the protocol before proceeding. If no design context exists yet, you MUST run /impeccable teach first.\n\n---\n\n"
    body += transform_content(ref_content)
    return fm + body

def main():
    actions = []

    # 1. Install master skill (copy whole folder from upstream built)
    src_master = UPSTREAM / '.claude' / 'skills' / 'impeccable'
    dst_master = LOCAL_SKILLS / 'impeccable'
    if src_master.exists():
        actions.append(('master_copy', src_master, dst_master))

    # 2. Sync 18 + create 6 split skills
    cmds = list(CMD_DESCRIPTIONS.keys())
    cmds.remove('impeccable')  # master handled separately

    ref_dir = UPSTREAM / 'skill' / 'reference'
    for cmd in cmds:
        ref_file = ref_dir / f'{cmd}.md'
        if not ref_file.exists():
            print(f'  [skip] no reference for {cmd}')
            continue
        target_dir = LOCAL_SKILLS / f'impeccable-{cmd}'
        target_file = target_dir / 'SKILL.md'
        is_new = not target_file.exists()
        actions.append(('split_skill', ref_file, target_file, cmd, is_new))

    # Print actions
    print(f'[sync_impeccable_v3] {"DRY-RUN" if DRY else "APPLY"}: {len(actions)} actions\n')
    new_count = 0
    upd_count = 0
    for a in actions:
        if a[0] == 'master_copy':
            print(f'  master: {a[1]} → {a[2]}')
        elif a[0] == 'split_skill':
            tag = '[NEW]' if a[4] else '[UPD]'
            if a[4]:
                new_count += 1
            else:
                upd_count += 1
            print(f'  {tag} impeccable-{a[3]}: {a[1].name} → {a[2]}')

    if DRY:
        print(f'\n[DRY] would update {upd_count} existing + create {new_count} new + master.')
        return

    # Apply
    for a in actions:
        if a[0] == 'master_copy':
            src, dst = a[1], a[2]
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(src, dst)
            print(f'  ✓ master copied: {dst}')
        elif a[0] == 'split_skill':
            ref_file, target_file, cmd, is_new = a[1], a[2], a[3], a[4]
            content = ref_file.read_text(encoding='utf-8')
            skill_md = build_skill_md(cmd, content)
            target_file.parent.mkdir(parents=True, exist_ok=True)
            target_file.write_text(skill_md, encoding='utf-8')
            tag = '✓ NEW' if is_new else '✓ UPD'
            print(f'  {tag} impeccable-{cmd}')

    print(f'\n[DONE] master + {upd_count} updated + {new_count} new skills.')

if __name__ == '__main__':
    main()
