import fs from 'node:fs';
import crypto from 'node:crypto';
import postcss from 'postcss';
const root = new URL('../', import.meta.url);
const pulse = fs.readFileSync(new URL('../pulse.html', root), 'utf8');
const corner = fs.readFileSync(new URL('../ugol-varianty.html', root), 'utf8');
const wanted =
  /\.(?:верх|баран|vklad|navig|baraban|god|kvartal|mesyats|nedelya|shield|lv(?:[\s.>:\-\[,{]|$)|lv-|разрез|кнопка-темы|угол-|линейка|upravlenie|podved|прибор|сетка-б|счёт|тема-)/u;
function extract(css, rootVars = true) {
  const tree = postcss.parse(css);
  tree.walkComments((n) => n.remove());
  tree.walkRules((r) => {
    if (r.parent?.type === 'atrule' && /keyframes/.test(r.parent.name)) return;
    if (!(rootVars && /:root|\.tma/.test(r.selector)) && !wanted.test(r.selector)) r.remove();
  });
  tree.walkAtRules((a) => {
    if (a.nodes && a.nodes.length === 0) a.remove();
  });
  return tree.toString();
}
const css = pulse.match(/<style>([\s\S]*?)<\/style>/)[1];
const cornerCss = corner.match(/<style>([\s\S]*?)<\/style>/)[1];
fs.writeFileSync(
  new URL('src/source-shell/original.css', root),
  '/* Extracted from repository HTML by scripts/extract-source-shell.mjs. Do not restyle the source objects here. */\n' +
    extract(css) +
    extract(cornerCss, false),
);
const nav = pulse.match(/<nav class="vkladki"[\s\S]*?<\/nav>/)[0];
const shield = pulse
  .match(/<button type="button" class="shield shield-razdel-puls"[\s\S]*?<\/button>/)[0]
  .replace(/<button[^>]*>/, '')
  .replace(/<\/button>$/, '')
  .replace(/<span class="shield-otschet"[\s\S]*?<\/span>/, '');
fs.writeFileSync(new URL('src/source-shell/navigation.html', root), nav);
fs.writeFileSync(new URL('src/source-shell/shield.html', root), shield.split('\n').map(line=>line.trimEnd()).join('\n').trim()+'\n');
fs.writeFileSync(
  new URL('src/source-shell/sources.json', root),
  JSON.stringify(
    {
      pulse: {
        path: 'docs/superpowers/mockups/pulse.html',
        sha256: crypto.createHash('sha256').update(pulse).digest('hex'),
      },
      corner: {
        path: 'docs/superpowers/mockups/ugol-varianty.html',
        sha256: crypto.createHash('sha256').update(corner).digest('hex'),
      },
      method:
        'Original navigation markup, shield SVG and selected CSS rules. Interactions adapted to React; no Pulse content copied.',
    },
    null,
    2,
  ) + '\n',
);
