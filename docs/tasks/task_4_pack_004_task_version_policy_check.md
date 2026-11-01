# Task 4 · Pack · 004 — 프로젝트 빌드가 읽지 못하는 Task 버전 영향 값을 등록 입구에서 거절

상태: planned

Task Category: pack

Category Index: 004

Index Priority: P1 planned-next

Index Areas: Decal Pack, capability entry, Task registration

Index Summary: 프로젝트가 선언한 Task 버전 영향 값 밖의 등록을 its-register.mjs에서 거절하고, 선언 없는 프로젝트는 그대로 둔다.

Version Impact: none

Version Applied: pending

Remote Version Impact: none

Remote Version Applied: not-required

Registration Intent: task-version-policy-20261101-pack:version_policy

## Context Budget

- 필수: packs/decal-pack/src/contracts/task-work-bug/its-register.mjs, capabilities.json, tests/capability-entry.test.mjs, tests/decal-pack-source.test.mjs, scripts/verify-decal-pack-source.mjs, packs/decal-pack/pack.source.json
- 제외: 발행된 번호 계약 bytes 변경, Work·Bug·Incident 등록 값, Pack 버전 확정·tag·게시, 데칼 동기화

## 사용자 요약

```zuz-its-context
{
  "schemaVersion": 1,
  "reason": "데칼 Task 829가 Version Impact: desktop-patch로 등록됐고, 등록 계약은 받아들였지만 데칼 빌드가 이 값을 읽지 못해 main의 데스크탑 빌드가 모두 실패했습니다. 외부 AI가 쓰는 고정 입구 its-register.mjs에는 이를 막는 검사가 없습니다.",
  "goal": "프로젝트가 자기 빌드가 읽는 값을 선언하면, 그 밖의 값으로 Task를 등록할 때 입구가 이유와 함께 거절합니다.",
  "completion": "- 선언한 프로젝트에서 --kind task --dry-run이 desktop-patch를 명확한 코드로 거절합니다.\n- 선언하지 않은 프로젝트는 이전과 같습니다.\n- Work·Bug는 영향이 없습니다.\n- 두 경우 모두 회귀 시험이 있고 발행된 계약 bytes는 그대로입니다.",
  "nextAction": "새 번호 계약을 worktree에서 구현하고 시험합니다. Pack 게시와 데칼 동기화는 별도 승인입니다."
}
```

## 범위와 기존 기록 대조

프로젝트 선언 파일 `config/its-version-policy.json`, 이를 검사하는 새 번호 계약, 고정 입구와 capabilities 연결, 회귀 시험을 소유합니다. Task 1(입구 도입), Task 2(미연결 기기 차단), BUG-3(Windows 잠금)과 목표와 완료 기준이 다릅니다. 기준 코드는 데칼이 이미 쓰는 v24~v26이 있는 fix/pairing-trust-v24 브랜치이며, 이 브랜치는 아직 main에 병합되지 않았습니다.

## 사용자 승인과 경계

2026-11-01 사용자가 이 저장소의 읽기, 규약에 따른 등록과 커밋, 새 worktree 구현·시험·커밋을 승인했습니다. push·merge·Pack 버전 확정·tag·Store 공개·데칼 동기화는 포함되지 않습니다.

## Remote parity

Remote parity: not-required
Remote disposition: not-applicable — 화면·프로토콜 변경 없이 외부 AI의 등록 입구만 바꿉니다.

## 후속

데칼 동기화 때 데칼의 `config/its-version-policy.json`과 `scripts/slice_version_policy.mjs` 값이 어긋나지 않는지 검사하는 시험을 데칼 쪽에 둡니다.
