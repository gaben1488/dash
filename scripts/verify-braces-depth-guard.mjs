import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const requireFromWeb = createRequire(new URL('../packages/web/package.json', import.meta.url));
const tailwindPackage = requireFromWeb.resolve('tailwindcss/package.json');
const requireFromTailwind = createRequire(tailwindPackage);
const chokidarPackage = requireFromTailwind.resolve('chokidar/package.json');
const requireFromChokidar = createRequire(chokidarPackage);
const braces = requireFromChokidar('braces');
const bracesPackage = requireFromChokidar('braces/package.json');

assert.equal(bracesPackage.version, '3.0.3',
  'Security patch contract must be reviewed when the upstream braces version changes.');

const nested = depth => '{'.repeat(depth) + 'a,b' + '}'.repeat(depth);
assert.doesNotThrow(() => braces.parse(nested(100)));
assert.throws(() => braces.parse(nested(101)), /exceeds max depth/);
assert.throws(() => braces.parse('{{a,b},c}', { maxDepth: 1.5 }), /exceeds max depth/);

const deepAst = () => {
  let ast = { type: 'text', value: 'a' };
  for (let i = 0; i < 101; i++) ast = { type: 'brace', nodes: [ast] };
  return { type: 'root', nodes: [ast] };
};

for (const [name, operation] of [
  ['compile', () => braces.compile(deepAst())],
  ['expand', () => braces.expand(deepAst())],
  ['stringify', () => braces.stringify(deepAst())],
]) {
  assert.throws(operation, /exceeds max depth/, `${name} must reject caller-supplied deep ASTs`);
}

for (const pattern of ['{{a}}', '{a,{b}}', '{{x}y}', '{a,{b,{c}}', '{}{a}']) {
  assert.equal(
    braces.stringify(braces.parse(pattern), { escapeInvalid: true }),
    pattern,
    'Depth guard must preserve braces@3.0.3 stringify compatibility.',
  );
}

console.log('braces@3.0.3 local CVE-2026-93687 depth guard: PASS');
