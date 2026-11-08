# Task 7 · Pack · 007 — 설치 규약의 짧은 입구와 작업별 스킬 안내

상태: in_progress

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

짧은 정책 입구와 상세 원본 분리, Task/Work/Bug/Incident 스킬의 선택 읽기, 이전 설치와 수정본 보호, source 검증·전체 테스트·정확한 커밋·결정적 Pack 빌드.

## Remote parity

not-applicable: UI 없는 Pack 원본이며 소비자 동일 의미를 보존한다.

## App.tsx 영향 계획

해당 없음.
