# Task 6 · Pack · 006 — Showcase 연결 프로젝트에만 설치되는 작업본 테스트 빌드 가이드 모듈과 audience 판정

상태: planned

Task Category: pack

Category Index: 006

Index Priority: P1 planned-next

Index Areas: Decal Pack, portable installer, Showcase, module audience

Index Summary: Showcase 연결 파일이 있는 프로젝트에만 작업본 테스트 빌드 가이드를 설치하고, 외부 설치기가 모듈 audience를 판정해 조건이 맞지 않는 모듈을 설치하지 않게 한다.

Version Impact: none

Version Applied: pending

Remote Version Impact: none

Remote Version Applied: not-required

Registration Intent: showcase-guide-module-20261107-pack:showcase_guide_module

## Context Budget

- 필수: packs/decal-pack/pack.source.json, schemas/decal-pack-source.schema.json, scripts/install-decal-pack.mjs, scripts/pack-lib.mjs, scripts/verify-decal-pack-source.mjs, tests/portable-installer.test.mjs, tests/decal-pack-source.test.mjs
- 참고: Tool_LauncherHub docs/showcase_worktree_test_build.md(가이드 정본), contracts/showcase-project-contract-v2.schema.json(연결 파일 형식)
- 제외: 발행된 계약 bytes 변경, Pack 빌드·tag·Store 공개, 데칼 동기화·Native 판정기 구현, 다른 프로젝트 설치

## 사용자 요약

```zuz-its-context
{
  "schemaVersion": 1,
  "reason": "Showcase 작업본 테스트 빌드 가이드는 Showcase 앱이 Decal 세션에만 넣어 주고, 데칼 밖 세션은 받을 길이 없습니다. Pack 모듈에는 설치 대상 조건(audience) 자리가 있지만 판정하는 곳이 없어서, 데칼은 그런 모듈을 무조건 막고 외부 설치기는 조건을 읽지 않습니다.",
  "goal": "Showcase 연결 파일(.zuz.dev/showcase/project.json)이 있는 프로젝트에만 가이드가 설치되고, 조건이 맞지 않으면 설치되지 않습니다.",
  "completion": "- 새 모듈이 Showcase 연결 프로젝트에서만 설치됩니다.\n- 연결 파일이 없거나 형식이 틀리거나 symlink면 그 모듈만 설치하지 않고 이유를 알립니다.\n- 판정기가 없는 audience 값은 설치하지 않습니다.\n- verify:source와 전체 npm test가 통과합니다.",
  "nextAction": "worktree에서 모듈과 외부 설치기 판정을 구현하고 시험합니다. Pack 확정·게시와 데칼 Native 판정은 별도 승인입니다."
}
```

## 범위와 기존 기록 대조

새 모듈, 가이드 사본과 정본 digest 고정, 외부 설치기의 audience 판정, 소스 스키마·검증기 보강, 회귀 시험을 소유합니다. Task 1~5는 등록·전이·정산 계약이라 범위가 달라 재사용하지 않습니다. 데칼 Native의 같은 판정은 데칼 저장소의 별도 기록이 맡습니다.

## 사용자 승인과 경계

2026-11-07 사용자가 이 저장소의 읽기와 브랜치에서의 구현·커밋을 승인했고, 감지 기준을 Showcase 연결 파일로 정했습니다. push·merge·Pack 버전 확정·tag·Store 공개·데칼 동기화·다른 프로젝트 설치는 포함되지 않습니다.

## Remote parity

Remote parity: not-required
Remote disposition: not-applicable — 화면·프로토콜 변경 없이 Pack 소스와 포터블 설치기만 바꿉니다.

## 완료 기준

- [ ] 새 모듈이 Showcase 연결 프로젝트에서만 설치됩니다.
- [ ] 연결 파일 없음·형식 오류·symlink·알 수 없는 audience는 그 모듈을 설치하지 않습니다.
- [ ] 가이드 사본이 정본 digest와 일치하는지 검증합니다.
- [ ] verify:source와 전체 npm test가 통과합니다.
