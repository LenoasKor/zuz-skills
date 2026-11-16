import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = (path) => readFileSync(new URL(`../packs/decal-pack/src/skills/prompts/${path}`, import.meta.url), 'utf8');
// Prompt contract regressions, not claims about executed model behavior.
test('motion roles preserve distinct write and review authority', () => {
  assert.match(read('decal-animate.md'), /risk: project_write/);
  assert.match(read('decal-animate.md'), /never broadens commit, push, deployment, or external-action authority/);
  for (const file of ['decal-improve-animations.md', 'decal-review-animations.md']) {
    assert.match(read(file), /risk: read_only/);
    assert.match(read(file), /does not implement|does not write features/);
  }
});
test('zero audit findings cannot manufacture a plan, question, or ticket', () => {
  const audit = read('decal-improve-animations.md');
  assert.match(audit, /no plans, selection question, or new work item/);
  assert.match(audit, /Do not pad the audit to a quota/);
  assert.match(audit, /exemption, existing record, then new record if needed/);
  assert.doesNotMatch(audit, /list 2–4|default to the top 3–5|~5, HIGH/);
});
test('duration defaults and justified exceptions agree across entry and companions', () => {
  for (const file of ['decal-animate.md', 'resources/decal-review-animations/STANDARDS.md', 'resources/decal-improve-animations/AUDIT.md']) {
    const text = read(file);
    assert.match(text, /200–250ms by default; 300–500ms only for a justified, occasional large transition/);
    assert.match(text, /documented purpose and responsiveness check/);
    assert.doesNotMatch(text, /Modals, drawers \| 200–500ms/);
  }
});
test('reduced motion can be static or fade without an artificial transform requirement', () => {
  for (const file of ['decal-animate.md', 'resources/decal-review-animations/STANDARDS.md', 'resources/decal-improve-animations/AUDIT.md']) {
    const text = read(file);
    assert.match(text, /Reduced motion may be static/);
    assert.doesNotMatch(text, /not zero/);
  }
  assert.match(read('decal-review-animations.md'), /Pure fades and static states are valid reduced-motion variants/);
  assert.match(read('resources/decal-improve-animations/PLAN-TEMPLATE.md'), /meaningful static or gentle feedback remains/);
});
test('generic registry prompts do not impose Decal historical numbers or App.tsx', () => {
  for (const file of ['decal-slice-hygiene.md', 'decal-slice-plan-report.md']) {
    const text = read(file);
    assert.doesNotMatch(text, /Slice 341|App\.tsx/);
    assert.match(text, /risk: read_only/);
    assert.match(text, /프로젝트가 요구하는/);
    assert.match(text, /두 registry가 동시에 있으면 쓰기를 중단/);
  }
});

test('adapted resources retain immutable upstream provenance instead of claiming verbatim bytes', () => {
  const manifest = JSON.parse(readFileSync(new URL('../packs/decal-pack/src/vendor/emil-kowalski-animation/manifest.json', import.meta.url), 'utf8'));
  for (const name of ['STANDARDS.md', 'AUDIT.md']) {
    assert.equal(manifest.verbatimResources.some(x => x.upstream.endsWith('/' + name)), false);
    const adapted = manifest.adaptedResources.find(x => x.upstream.endsWith('/' + name));
    assert.ok(adapted?.upstreamSha256);
    assert.ok(adapted.adaptations.length > 0);
  }
});
