# Task 3 · Pack · 003 — 추적 필요성 기반 ITS 규약과 스킬·설치기 일치

상태: planned

Task Category: pack

Category Index: 003

Index Priority: P0 active

Index Areas: ITS, Skills, Pack, Policy

Index Summary: 단순 실행에 티켓을 만들지 않고 추적 필요성에 따라 등록·재사용하며 규약과 배포 사본을 일치시킨다.

Version Impact: none

Version Applied: pending

Remote Version Impact: none

Remote Version Applied: not-required

Registration Intent: its-proportional-tracking-20261011-pack:tracking

## Context Budget

- 필수: AGENTS.md, docs/decal-pack-release-guide.md, packs/decal-pack/src/skills, scripts/install-decal-pack.mjs, packs/decal-pack/pack.source.json
- 제외: 공개된 버전별 계약 bytes 변경, 무관한 기존 기록 정리, 다른 제품 저장소

## 사용자 요약

```zuz-its-context
{
  "schemaVersion": 1,
  "reason": "단순 커밋과 push에도 Work를 만드는 구 규약이 최신 면제 기준과 함께 남아 작업을 불필요하게 나눕니다.",
  "goal": "등록 불필요, 기존 기록 재사용, 새 기록 필요 순서로 판단하고 스킬과 설치기가 같은 기준을 전달합니다.",
  "completion": "- 단순 커밋·push·작은 변경에는 새 티켓을 요구하지 않습니다.\n- 독립적인 기능·결함과 실행 권한 보호는 유지됩니다.\n- 규약·스킬·설치본의 의미가 같고 관련 검증이 통과합니다.",
  "nextAction": "담당 AI가 원본과 소비 경로를 수정·검증·커밋하고 push·배포 전 상태를 보고합니다."
}
```

## 범위와 기존 기록 대조

Task 1은 기능 대응표와 다기기 등록 입구, Task 2는 미연결 기기 발급 차단을 소유합니다. 두 경로는 재사용하고 수정하지 않습니다. 이번 기록은 등록 필요성 판단, 스킬 안내, 설치 규칙 생성, 검증 사례를 소유합니다. Decal 소비 변경은 해당 저장소 기록으로 연결합니다.

## 사용자 승인과 경계

2026-10-11 사용자가 검수 추천 방향과 두 저장소 열람·수정·검증·커밋을 승인했습니다. push·merge·배포·앱 재시작·다른 프로젝트 설치는 하지 않고 준비 상태를 보고합니다. 새 동작별 Work를 만들지 않습니다.

## Remote parity

Remote parity: not-required
Remote disposition: not-applicable — 화면·프로토콜 변경 없이 동일 Desktop Host와 공통 Pack 지시를 사용합니다. 네 공급자와 Native/외부 Host의 권한 의미를 함께 검증합니다.

## App.tsx 영향 계획

직접 변경 0줄.

## 완료 기준

- [ ] 등록 필요성 판정을 통일하고 커밋·push·기존 작업 단계의 중복 등록을 제거한다.
- [ ] 현재 운영 지시와 legacy 호환 설명을 분리하고 기존 보호 조건을 유지한다.
- [ ] 원본 스킬·설치기·공급자별 사본과 관련 검증이 일치한다.
- [ ] 변경을 격리 커밋하고 push·배포 준비 상태와 미검증 범위를 보고한다.
