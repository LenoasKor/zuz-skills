# Task 5 · Pack · 005 — 출시 전 개발완료 Work·Bug를 정식 경로로 다시 열기

상태: development_complete

Task Category: pack

Category Index: 005

Index Priority: P1 planned-next

Index Areas: Decal Pack, Work Bug bookkeeping, reopen

Index Summary: 출시 전이고 버전이 적용되지 않은 개발완료 Work·Bug를 새 번호 계약으로 이력을 보존한 채 다시 연다.

Version Impact: none

Version Applied: pending

Remote Version Impact: none

Remote Version Applied: not-required

Registration Intent: pre-live-reopen-20261105-pack:pre_live_reopen

## Context Budget

- 필수: packs/decal-pack/src/contracts/task-work-bug/v12(재사용·재개), v11·v28(출시 단계 수명주기), pack.source.json, project-skill-pack-policy.json, decal-work·decal-bug·zuz-its 스킬, scripts/verify-decal-pack-source.mjs, tests/decal-pack-source.test.mjs
- 제외: 발행된 번호 계약 bytes 변경, Pack 버전 확정·tag·게시, 데칼 동기화·다른 프로젝트 설치

## 사용자 요약

```zuz-its-context
{
  "schemaVersion": 1,
  "reason": "출시 전 프로젝트의 Work·Bug는 개발완료에서 끝나는데, 포터블 재개 계약(v12)은 closed 기록만 다시 열어 줍니다. Tool_LauncherHub BUG-046은 Windows에서 같은 완료 기준이 깨졌지만 개발완료 상태라 다시 열 수 없어, 고치지 않은 기록을 한 번 fixed로 닫은 뒤 재개하는 우회를 썼습니다.",
  "goal": "출시 전이고 버전이 적용되지 않은 개발완료 Work·Bug를 새 계약으로 바로 다시 엽니다. 이전 완료 근거와 버전 값은 재개 이력에 그대로 남고, 출시된 기록은 지금처럼 새 기록으로 분리합니다.",
  "completion": "- 출시 전·버전 미적용 개발완료 Work·Bug가 사유와 함께 planned·confirmed로 돌아갑니다.\n- 이전 completion·closure·버전 필드 바이트가 reopenHistory에 남습니다.\n- live, 버전 적용됨, release_ready, 정산된 task-batch 기록은 계속 거절됩니다.\n- v1 요청과 closed 재개는 v12와 같게 동작하고, 발행된 계약 bytes는 바뀌지 않습니다.",
  "nextAction": "새 번호 계약을 worktree에서 구현하고 시험합니다. Pack 확정·게시와 데칼 동기화는 별도 승인입니다."
}
```

## 범위와 기존 기록 대조

새 번호 계약(v29)의 bookkeeping runner, 요청 스키마 v2(출시 단계 결속), README·manifest·verify-contract, Pack 연결, 스킬 안내, 회귀 시험을 소유합니다. BUG-8(v28, 정산 프로필 없는 일반 전이)은 정방향 전이만 다루므로 범위가 달라 재사용하지 않습니다. 데칼 Native 엔진의 같은 규칙은 데칼 Task 839가 소유합니다.

## 사용자 승인과 경계

2026-11-05 사용자가 이 저장소의 읽기, 규약에 따른 등록과 커밋, 새 worktree 구현·시험·커밋을 승인했습니다. push·merge·Pack 버전 확정·tag·Store 공개·데칼 동기화·다른 프로젝트 설치는 포함되지 않습니다.

## Remote parity

Remote parity: not-required
Remote disposition: not-applicable — 화면·프로토콜 변경 없이 포터블 runner만 바꿉니다.

## 완료 기준

- [x] 출시 전·버전 미적용 개발완료 Work·Bug 재개가 시험으로 확인됩니다.
- [x] live, 버전 적용됨, release_ready, 정산된 task-batch, 출시 단계 누락 요청은 거절됩니다.
- [x] v1 요청과 closed 재개는 v12와 같은 결과를 냅니다.
- [x] verify:source와 전체 npm test가 통과합니다.

## 작업 기록

- 등록: 데칼 Task 839 세션에서 Tool_LauncherHub BUG-046 우회 사례를 근거로 분리했습니다.
- 구현(2026-11-05, 브랜치 `feat/task-5-pre-live-reopen`, e9667d0): v28은 BUG-8이 이미 써서 새 계약을 v29로 정했습니다. `v29/work-item-bookkeeping.mjs`는 v1 요청을 v12에 그대로 맡기고, v2 요청(`releaseStage`·`releaseStageSource`, v11 정규화)에서만 `pre_live`·버전 미적용 `development_complete` 재개를 허용합니다. 출시 단계는 승인 지문의 operation 이름(`<kind>-reopen-<stored|defaulted>-pre-live`)으로 결속합니다. Pack의 `portableBookkeeping`·실행 정책을 v29로 옮기고, decal-work·decal-bug·decal-task·zuz-its 스킬 안내를 고쳤습니다(decal-task 1.21.0, zuz-its 1.6.0; work·bug는 미출시 1.16.0 유지).
- 검증: `tests/work-item-bookkeeping-v29.test.mjs` 12개 통과(허용: stored/defaulted/unset pre_live, 재재개 이력 누적, 정확한 단일 커밋; 거절: live, 데스크톱·Remote 버전 적용, 정산된 task-batch, release_ready(pre_live·live), v1 요청, reuse, 잘못된 출시 단계, stale revision, 빈 사유; v1·closed 재개는 v12와 바이트·승인 지문 동일). `npm run verify:source` 통과, 전체 `npm test` 339개 중 335 통과·4 건너뜀·0 실패.
- 남음: Pack 버전 확정·tag·Store 공개, 데칼 스냅샷 동기화(설치기 계약 파일 목록·`tests/verify-zuz-skills-pack.mjs` 고정값), 설치 프로젝트 갱신은 각각 사용자 승인 필요. main 병합도 승인 대기.
- 후속 후보: 완료 근거에 미검증 범위를 구조화(`completion.unverified` 등)해 개발완료 진입을 막는 계약, 스킬에 "요구 플랫폼 미검증이면 개발완료로 넘기지 않음" 규칙.
