# Task 3 · Pack · 003 — 추적 필요성 기반 ITS 규약과 스킬·설치기 일치

상태: in_progress

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

- [x] 등록 필요성 판정을 통일하고 커밋·push·기존 작업 단계의 중복 등록을 제거한다.
- [x] 현재 운영 지시와 legacy 호환 설명을 분리하고 기존 보호 조건을 유지한다.
- [x] 원본 스킬·설치기·공급자별 사본과 관련 검증이 일치한다.
- [x] 변경을 격리 커밋하고 push·배포 준비 상태와 미검증 범위를 보고한다.

## 검증 기록 · 2026-10-11

- 원본 검증: 31개 스킬·4개 모듈 통과. 전체 자동 검증 243건 중 242건 통과, 1건은 Git 임시 디렉터리 정리의 ENOTEMPTY였으며 해당 파일 4건 재실행 모두 통과.
- 설치기는 검증된 package의 정책 bytes를 사용하며, 구 관리 블록 갱신·사용자 수정 보존·네 공급자 projection을 검증했다.
- 독립 AI 검수의 12개 사례와 재검수에서 지적한 등록 면제·종료 기록·기존 승인·Incident 선택 조건을 반영했다.
- Decal Task 791이 내장본·Rust 설치기·저장소 규약·번역 fallback을 소비한다. 기존 Task 1·2의 등록 입구와 계약 bytes는 변경하지 않았다.
- 후보 Pack 3.9.1. source commit 후 결정적 빌드와 소비본 검증을 이어가며 공개 tag·push·배포는 미실행이다.

- 최종 전체 재검증: `npm test` 243/243 통과(0 실패). 원본 저장소의 기존 zuz-its 모듈과 acp·claude·codex 선택을 유지한 공식 설치기 갱신도 성공했다.
- 선행 source commit: `e2597a420707ee4386b33c3b3f2e85cf4b06a151`. 설치 영수증의 정확한 gitWriteSet만 별도 커밋한다.
- 저장소에 승인된 `.decal/settlement-profile.json`이 없어 portable 완료 상태 전이·정산은 수행하지 않는다. 구현·자동 검증·커밋 준비 사실을 이 기록에 남기고, 기존 in_progress 상태와 적용 버전 이력을 보존한다. 공개 출시와 정산은 다음 승인 단계다.
