import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const skill = name => readFileSync(new URL(`../packs/decal-pack/src/skills/prompts/${name}.md`, import.meta.url), 'utf8');
// Static contract tests, not an LLM execution benchmark.
test('quick review reports evidence limits and cannot create work just to review', () => {
 const s=skill('risk-review'); assert.doesNotMatch(s,/문제가 없으면 "이상 없음"/);
 for(const rule of [/읽기 전용/,/파일\/위치·발생 조건·영향·근거/,/실행하지 못한 검사/,/미검증 위험까지 없다고 단정하지/,/새 워커·티켓을 만들지/]) assert.match(s,rule);
});
test('health diagnosis accepts code and observed tests, never document-only health claims', () => {
 const s=skill('healthcheck'); for(const rule of [/실제 코드\/설정\/검사 근거/,/관측 사실·추정·확인 못 함/,/자동 티켓 발급/,/최대 5개/]) assert.match(s,rule);
 assert.doesNotMatch(s,/근거는 관련 Task 이름과 문서 링크만/);
});
test('start and resume remain separate compatible IDs without redundant exploration', () => {
 assert.match(skill('orient'),/^id: decal-orient$/m); assert.match(skill('status-summary'),/^id: decal-status-summary$/m);
 assert.match(skill('orient'),/작업 재개라면 코드베이스 전수 탐색 대신/);
 assert.match(skill('orient'),/dirty\/content 변경이 없음을 확인한 경우만/);
 assert.match(skill('orient'),/변경됐거나 변경 여부를 모르면 다시 읽으세요/);
 assert.match(skill('status-summary'),/이미 아는 구조·스타일을 다시 조사하지/);
 assert.match(skill('status-summary'),/별도 스킬 호출이나 워커 생성은 필수가 아니다/);
});
test('handoff preserves native boundary and carries verifiable continuation evidence', () => {
 const s=skill('handoff');for(const rule of [/root·branch·HEAD·dirty/,/실제 검증 명령\/결과/,/실행 앱 Build ID/,/실패한 시도/,/승인 출처 기록은 새 권한이 아니며/,/decal_ui\.request_confirmation/,/host recovery/,/DECAL_SESSION_ID/,/원본 CLI 버퍼/]) assert.match(s,rule);
});
