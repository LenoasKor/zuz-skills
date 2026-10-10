# Task 1 · Pack · 001 — 기능 대응표 입구와 다기기 번호 권한자 계약(v18·v19) 편입

상태: planned

Task Category: pack

Category Index: 001

Index Priority: P0 active

Index Areas: Decal Pack, task-work-bug contracts, skills, multi-device ITS

Index Summary: 스킬이 계약 번호 대신 기능 이름과 고정 입구만 쓰고, 입구는 광고되고 검증된 계약만 실행하며, 다기기 번호 권한자 계약 v18·v19를 Pack에 편입한다.

Version Impact: none

Version Applied: pending

Remote Version Impact: none

Remote Version Applied: not-required

Registration Intent: zs-capability-entry-multi-device-contracts-20261011:cap_entry

## Context Budget

- 필수:
  - `docs/decal-pack-release-guide.md` §1–3
  - `packs/decal-pack/pack.source.json`의 `compatibility`·`capabilities`·`modules`
  - `packs/decal-pack/src/contracts/task-work-bug/v15`·`v16`·`v17`과 `initialize-task-registry.mjs`
  - 데칼 저장소 `contracts/task-work-bug/v18`·`v19`와 `tests/verify-its-authority-v18.mjs`, `tests/verify-its-lan-pairing-v19.mjs`(원본 구현·시험, 읽기 전용 참조)
- 조건부:
  - 스킬 문서 갱신 시 `packs/decal-pack/src/skills/`, `consumer-acceptance/v1`
  - 빌드·설치 시 `scripts/build-decal-pack.mjs`, `scripts/install-decal-pack.mjs`
- 기본 제외:
  - 이미 발행된 v1–v17 계약 bytes(수정 금지), `dist/` 직접 편집

## 사용자 요약

```zuz-its-context
{
  "schemaVersion": 1,
  "reason": "스킬 문서에 계약 번호(v10·v15)가 박혀 있어 새 계약이 나올 때마다 스킬 사본을 고쳐야 하고, 두 기기가 동시에 등록하면 번호가 겹치는 문제를 막는 다기기 계약(v18·v19)은 아직 Pack에 없습니다.",
  "goal": "AI가 계약 번호 대신 '무엇을 하려는지'만 말하면 설치된 Pack이 광고하고 검증을 통과한 계약으로 연결되고, 같은 네트워크의 여러 기기가 번호를 겹치지 않게 등록합니다.",
  "completion": "- 고정 입구 하나로 Task·Work·Bug·Incident 등록이 되고 연결된 프로젝트는 권한자로 위임됩니다.\n- 대응표에 없는 폴더와 검증에 실패한 계약은 실행되지 않으며 낮은 버전으로 내려가지 않습니다.\n- 스킬 문서에서 계약 번호 지시가 사라지고 네 공급자(Codex·Claude·Gemini·ACP)가 같은 의미를 갖습니다.\n- v18·v19 계약이 Pack 후보에 포함되어 verify:source와 시험이 통과합니다.",
  "nextAction": "담당 AI가 이 저장소의 새 worktree에서 입구·대응표·계약 편입과 스킬 문서 갱신을 구현하고 시험합니다. Pack 버전 확정과 배포는 사용자 승인 뒤에 진행합니다."
}
```

## 목표

1. 고정 경로 입구(`contracts/task-work-bug/its-register.mjs`)와 기능→계약 대응표(`capabilities.json`)를 Pack에 추가한다. 입구는 대응표에 적힌 계약만, 해당 계약의 verify-contract 통과 후에만 실행한다. 각 기능은 계약 하나에 대응하고 낮은 버전으로 내려가지 않는다.
2. 데칼 저장소에서 개발·시험된 `task-work-bug/v18`(수동 권한자)·`v19`(같은 네트워크 무설정 연결)을 새 계약 버전으로 편입한다. 발행된 v1–v17 bytes는 바꾸지 않는다.
3. 프로젝트가 다른 기기와 연결(페어링)되어 있으면 반드시 권한자 경로를 쓰고, 그 경로가 불가하면 로컬 등록으로 새지 않고 멈춘다.
4. decal-task·decal-work·decal-bug·decal-incident·zuz-its 스킬 문서와 네 공급자 acceptance fixture에서 계약 번호 지시를 기능 이름과 고정 입구 안내로 바꾼다.
5. `packVersion`·`compatibility`(예: `portableMultiDeviceRegistration`)·`capabilities`·실행 정책을 실제 변화와 맞춘다.

## 범위

- `packs/decal-pack/src/contracts/task-work-bug/`의 새 입구·대응표·v18·v19, `pack.source.json`, 스킬 문서, consumer-acceptance, 시험
- 설치기·빌드 스크립트가 새 파일 목록을 올바르게 다루는지 확인

## 제외

- Pack 버전 확정, GitHub tag·Release, Skill Store 공개, 소비 프로젝트(Decal·Primer·Jig) 갱신은 각각 별도 승인 단계다.
- 상태 전이·정산 입구 통합(필요하면 후속)
- 다른 저장소 변경(데칼 쪽 스냅샷·설치기는 데칼 Task 788에서 수행)

## 완료 기준

- [ ] `its-register.mjs`와 `capabilities.json`이 있고 Task·Work·Bug·Incident 등록과 권한자 위임이 입구로 된다.
- [ ] 대응표에 없는 계약 폴더(예: v99)와 검증에 실패한 계약은 실행되지 않고 낮은 버전으로 폴백하지 않는다.
- [ ] 연결된 프로젝트에서 권한자 경로가 불가하면 로컬 등록 없이 멈춘다.
- [ ] v18·v19가 새 계약 버전으로 편입되고 manifest 검증이 통과한다.
- [ ] 스킬 문서에서 계약 번호 지시가 제거되고 네 공급자가 같은 의미를 갖는다.
- [ ] `npm run verify:source`와 `npm test`가 통과한다.

## 검증 후보

- `npm run verify:source`, `npm test`, 입구 시험, 데칼 v19 acceptance를 Pack 후보 설치본으로 재실행

## 작업 로그

| 시각 | 에이전트 | 처리 내용 | 검증 결과 | 남은 일 |
| --- | --- | --- | --- | --- |
| 2026-10-11 | Claude | zuz-skills에 자체 ITS를 도입(Pack 3.7.1 설치 7dddd50, 등록소 초기화 7379068)한 뒤 첫 Task로 등록. 데칼 Task 786·787·788과 연결 | 등록 전 verify:source·시험 238개 통과 | 구현 |
