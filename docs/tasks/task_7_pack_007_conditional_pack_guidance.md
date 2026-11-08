# Task 7 · Pack · 007 — 설치 규약의 짧은 입구와 작업별 스킬 안내

상태: development_complete

Task Category: pack

Category Index: 007

Index Priority: P0 active

Index Areas: Decal Pack, ITS skills, installer

Index Summary: 쉬운 설명과 권한 보호를 유지하면서 기본 지침은 짧게, 상세는 필요한 기능별로 읽게 합니다.

Version Impact: none

Version Applied: pending

Remote Version Impact: none

Remote Version Applied: not-required

Registration Intent: zuz-pack-context-lightening-20261108:context_lightening

## Context Budget

- 필수: AGENTS.md, docs/decal-pack-release-guide.md, packs/decal-pack/pack.source.json, packs/decal-pack/src/contracts/its-tracking-policy.md.
- 조건부: scripts/install-decal-pack.mjs, build-decal-pack.mjs, tests, 관련 스킬 본문.
- 제외: 다른 프로젝트 설치, 공개 계약 bytes 변경.

## 사용자 요약

```zuz-its-context
{
  "schemaVersion": 1,
  "reason": "기본 규약에 상세 정책이 복사되고 스킬에서 같은 정책과 모든 실행 경로를 다시 읽습니다.",
  "goal": "기본 입구와 현재 작업에 필요한 상세만 읽고 기존 권한과 안전 기준은 유지합니다.",
  "completion": "- 원본 정책과 짧은 입구를 분리합니다.\n- Native·외부 절차를 필요한 때 읽습니다.\n- 이전 설치·사용자 수정 보존과 네 공급자 파일을 검증합니다.",
  "nextAction": "원본 수정·검증·커밋 후 같은 소스의 Pack을 빌드하여 승인된 데칼 저장소에 반영합니다."
}
```

## 범위와 승인

2026-11-08 사용자가 공통 저장소 열람·수정·검증·커밋을 승인했다. Decal Task 849와 연계하며 Task 3의 완료된 정책 의미는 보존한다. 새 Task는 conditional guidance·설치 호환의 독립 수용 기준이다. 공개 push·배포·타 소비자 설치는 포함하지 않는다.

## 완료 기준

- [x] 짧은 정책 입구와 상세 원본 분리.
- [x] Task/Work/Bug/Incident 스킬의 선택 읽기.
- [x] 이전 설치와 수정본 보호, 네 공급자 동일 bytes 검증.
- [x] source 검증·전체 테스트·정확한 커밋·결정적 Pack 빌드.

## Remote parity

not-applicable: UI 없는 Pack 원본이며 소비자 동일 의미를 보존한다.

## App.tsx 영향 계획

해당 없음.

## 구현 기록 · 2026-11-08

- Pack 3.14.0 / zuz-its module 1.11.0: 짧은 정책 입구와 작업별 상세 문서를 추가했다. Task/Work/Bug/Incident entry의 patch version과 minimumCompatible을 함께 올렸다. 기존 versioned 계약 bytes와 전체 tracking policy는 보존했다.
- 분리한 각 상세 본문은 변경 전 스킬의 원문과 일치함을 확인했고 hash fixture로 회귀를 검사한다. 네 공급자 설치 대상과 파일 해시 동일성을 유지한다.
- Native/portable 권한, 외부 root 승인, 정산 복구·재개·등록의 절차는 해당 동작 전에 명시 문서를 읽는 계약으로 옮겼다. 없어지거나 읽지 못하면 그 동작만 보류한다.
- 설치기는 package-owned 짧은 안내를 사용하되 기존 Pack은 기존 정책을 유지한다. lock에 결속한 이전 구획만 교체하고 수정본은 거절한다.
- 전체 테스트에서 새 문서 위치를 따라가지 않던 검사 한 건을 수정했고 해당 검사는 재통과했다. 최종 전체 재검증 후 source commit과 결정적 빌드를 수행한다. 실제 공개 배포와 타 소비자 설치는 이 작업에 포함하지 않는다.

최종 source 검증: `npm run verify:source` 통과, `npm test` 342개 중 338 통과·4 조건부 skip·0 실패. 분리된 원문 보존 3개 검사 및 diff whitespace 검사 통과.

## 로컬 Pack 빌드 영수증

Source commit `19820cdf922a408e38cb6f46afe64a5b6e402030`, Pack 3.14.0, 31 skills / 373 files. 동일 소스 재빌드 해시 일치: manifest identity `d65790601d6e6b4e53c2aa0be3563617e3ccc3beda8f51c0f63d7449f471ef80`, manifest file `470c80f00f77f8f5266bb45fddb99acda0fdb30bbdecfa004733bd2b098d68b9`, package `ed683f5f1fcdf8b11819d489a8f4978a1fad60cfb69f0005856e14b2a68b3825`. Decal Task 849에서 이 archive를 내장 동기화했다. 공개 배포·다른 소비 프로젝트 설치는 하지 않았다.
