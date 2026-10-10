import test from 'node:test';
import assert from 'node:assert/strict';
import palettes from '../src/source-shell/palettes.json' with { type: 'json' };

// An endpoint check is only the first gate: overlays, transparency, focus,
// and intermediate gradient stops still need actual rendered contrast QA.
function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(c => Number.parseInt(c, 16) / 255);
  const linear = channels.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}
test('39 исходных пар остаются привязаны к 13 маршрутам в каждой семье', () => {
  assert.deepEqual(palettes.map(p => p.name), ['Космос', 'Камчатка', 'Минералы']);
  const reference = palettes[0].tabs.map(t => t.name);
  assert.equal(reference.length, 13);
  for (const palette of palettes) {
    assert.deepEqual(palette.tabs.map(t => t.name), reference);
    assert.equal(new Set(palette.tabs.map(t => t.name)).size, 13);
  }
});
test('контраст подписи к обоим концам градиента ≥4,5:1 без изменения палитр', () => {
  for (const family of palettes) for (const tab of family.tabs) {
    for (const key of ['top','bottom']) {
      assert.match(tab[key], /^#[0-9a-f]{6}$/i);
      assert.match(tab.ink, /^#[0-9a-f]{6}$/i);
      assert.ok(contrast(tab.ink, tab[key]) >= 4.5,
        family.name + ' / ' + tab.name + ' / ' + key + ': ' + contrast(tab.ink, tab[key]).toFixed(2));
    }
  }
});
