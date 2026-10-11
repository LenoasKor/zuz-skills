# Task 2 · Pack · 002 — 연결 안 된 기기의 로컬 번호 발급 차단(pairing_required)과 Pack 3.9.0 후보

상태: in_progress

Task Category: pack

Category Index: 002

Index Priority: P1 planned-next

Index Areas: Decal Pack, capability entry, multi-device ITS

Index Summary: 권한자가 같은 네트워크에 있는데 연결되지 않은 기기가 로컬 번호를 발급해 번호가 겹치는 것을 입구에서 막는다.

Version Impact: none

Version Applied: pending

Remote Version Impact: none

Remote Version Applied: not-required

Depends On: [1]

Registration Intent: zs-pairing-required-unpaired-device-20261011:pairing_required

## Context Budget

- 필수:
  - `docs/tasks/task_1_pack_001_capability_entry_and_multi_device_authority_contracts.md`
  - `packs/decal-pack/src/contracts/task-work-bug/its-register.mjs`, `capabilities.json`
  - `packs/decal-pack/src/contracts/task-work-bug/v19/lan-discovery.mjs`, `tests/lan-pairing-v19.test.mjs`, `tests/capability-entry.test.mjs`
  - `docs/decal-pack-release-guide.md` §1–4
- 조건부: 빌드·설치 확인 시 `scripts/build-decal-pack.mjs`, `scripts/install-decal-pack.mjs`
- 기본 제외: 이미 발행된 v1–v19 계약 bytes(수정 금지), `dist/` 직접 편집

## 사용자 요약

```zuz-its-context
{
  "schemaVersion": 1,
  "reason": "같은 네트워크에 번호 발급기가 있는데 아직 연결하지 않은 기기가 이슈를 등록하면 그 기기가 로컬 번호를 발급해 다른 기기와 번호가 겹칩니다. 연결을 깜빡하면 아무 경고 없이 일어납니다.",
  "goal": "권한자가 같은 네트워크에 있는데 연결되지 않은 기기는 로컬 번호를 발급하지 않고 '먼저 연결하라'는 안내와 함께 멈춥니다. 권한자 기기 자신과 단독 사용 프로젝트는 지금처럼 로컬로 등록합니다.",
  "completion": "- 연결 안 된 기기의 등록이 `pairing_required`로 멈추고 아무것도 기록되지 않습니다.\n- 권한자 기기 자신의 등록은 권한자가 켜져 있어도 로컬로 됩니다.\n- 단독 사용 프로젝트는 달라지지 않고 미리보기는 항상 됩니다.\n- 탐지 기능이 대응표에 있고 검증을 통과해야만 실행되며, 변조되면 멈춥니다.\n- Pack 3.9.0 후보로 빌드되고 시험이 통과합니다.",
  "nextAction": "담당 AI가 worktree에서 입구에 권한자 탐지를 추가하고 실제 권한자 프로세스로 시험합니다. 병합·tag·게시는 별도 승인 뒤에 진행합니다."
}
```

## 목표

- 고정 입구가 쓰기 직전에, 연결(페어링)되지 않은 프로젝트에 대해 같은 네트워크에 이 프로젝트의 권한자가 있는지 짧게 확인한다(발견 요청 1회, 약 0.7초). 있으면 `pairing_required`로 멈추고 연결 방법을 안내한다.
- 권한자가 이 기기 자신이면(응답 주소가 이 기기의 주소) 막지 않는다. 미리보기(`--dry-run`)는 확인하지 않는다.
- 탐지는 대응표의 새 기능 `detect-authority`(v19 `lan-discovery.mjs`)로만 실행하고, 목록에 있는데 검증이 실패하면 멈춘다. 대응표에 기능이 없는 이전 Pack은 지금처럼 동작한다.
- Pack 3.9.0 후보: 입구 변경이므로 packVersion·compatibility·시험을 갱신한다. v1–v19 bytes는 바꾸지 않는다.

## 제외

- 병합·tag·GitHub Release·Skill Store 게시(별도 승인), 소비 프로젝트 갱신
- 권한자 위임 우회 옵션(로컬 발급을 강제하는 플래그)은 만들지 않는다.

## 완료 기준

- [ ] 연결 안 된 기기에서 권한자가 있으면 쓰기가 `pairing_required`로 멈추고 기록이 없다.
- [ ] 권한자 기기 자신의 쓰기는 로컬로 성공한다.
- [ ] 단독 프로젝트와 미리보기는 영향이 없다.
- [ ] 탐지 계약이 변조되면 `authoring_update_required`로 멈춘다.
- [ ] `npm run verify:source`, `npm test` 통과, 3.9.0 후보 패키지 빌드.

## 작업 로그

| 시각 | 에이전트 | 처리 내용 | 검증 결과 | 남은 일 |
| --- | --- | --- | --- | --- |
| 2026-10-11 | Claude | 데칼 Task 787 1단계에서 분리해 등록 | 등록만 수행 | 구현 |
