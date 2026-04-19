"""Fix graphify-generated atom files in 60-Graph/ so Obsidian accepts frontmatter.

Problems fixed:
  1. source_file: backslash paths cause YAML escape errors. Convert to forward slashes.
  2. tags with parens - Obsidian tag rule disallows parens. Strip them.
  3. inline body tags - same.
  4. wikilinks with parens - keep (Obsidian allows), but strip trailing parens in tags only.
"""
import re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR/60-Graph")

FM_RE = re.compile(r'^(---\n)(.*?)(\n---\n)', re.DOTALL)

def clean_tag(t: str) -> str:
    # Remove parens/brackets but keep slashes/underscores/letters/digits/hyphens
    t = re.sub(r'[()\[\]{}<>]', '', t)
    # collapse multiple consecutive separators
    t = re.sub(r'/+', '/', t)
    t = re.sub(r'_+', '_', t)
    return t.strip('/_-')

def fix_fm(block: str) -> str:
    out = []
    in_tags = False
    for line in block.split('\n'):
        # backslash paths: turn every \ into / inside quoted strings for source_file
        if line.lstrip().startswith('source_file:'):
            key, _, val = line.partition(':')
            val = val.strip()
            if val.startswith('"') and val.endswith('"'):
                val = val[1:-1].replace('\\', '/')
                line = f'{key}: "{val}"'
            elif '\\' in val:
                val = val.replace('\\', '/')
                line = f'{key}: "{val}"'
        # tag list items
        stripped = line.strip()
        if stripped == 'tags:':
            in_tags = True
            out.append(line); continue
        if in_tags:
            if line.startswith('  - ') or line.startswith('    -'):
                tag_val = line.split('-', 1)[1].strip()
                tag_val = clean_tag(tag_val)
                out.append(f'  - {tag_val}')
                continue
            else:
                in_tags = False
        out.append(line)
    return '\n'.join(out)

def fix_body_tags(body: str) -> str:
    # find inline tags like #foo/bar(...) and strip parens
    def _clean(m):
        return '#' + clean_tag(m.group(1))
    return re.sub(r'#([A-Za-zА-Яа-я0-9_\-/()]+)', _clean, body)

count = 0
fixed = 0
for p in ROOT.glob('*.md'):
    count += 1
    txt = p.read_text(encoding='utf-8')
    m = FM_RE.match(txt)
    if not m:
        continue
    new_fm = fix_fm(m.group(2))
    body = txt[m.end():]
    new_body = fix_body_tags(body)
    new_txt = m.group(1) + new_fm + m.group(3) + new_body
    if new_txt != txt:
        p.write_text(new_txt, encoding='utf-8')
        fixed += 1

print(f"scanned {count}, fixed {fixed}")
