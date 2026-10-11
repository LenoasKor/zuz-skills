---
schema: decal.task-work-bug.bug-card
schemaVersion: 1
id: BUG-1
title: "최신 Pack 규약과 오래된 설치 영수증의 충돌 오판"
status: confirmed
priority: P1
taskRefs:
  - "3"
nextAction: "최신 패키지와 동일한 규약 구획을 보존 승인하고 실제 수정본 차단과 Decal 개발 루트 갱신을 검증한다."
versionImpact: none
remoteVersionImpact: none
releaseMode: standalone
releaseTaskRef: null
versionApplied: not-required
remoteVersionApplied: not-required
createdAt: "2026-10-11T16:01:21.137Z"
updatedAt: "2026-10-11T16:01:56.855Z"
blocked: null
completion: null
closure: null
---

## 사용자 요약

- 이유: Decal 루트의 스킬·규약은 선행 갱신됐으나 설치 영수증은3.6.2여서 최신과 동일한 규약도 modified로 차단된다.
- 목표: 원하는 배포본과 완전히 동일한 규약은 보존하며 정상 설치 영수증을 발급한다.
- 완료 기준: 동일한 규약과 외부 사용자 문구 보존, 다른 수정본·삭제 차단, 실제 루트3.10.0 및 앱 경고 해소.
- 다음 행동: 조건 비교와 회귀 테스트를 수정·검증한 후 승인된 소비 루트에 적용한다.

## 진단과 범위

plannedPackRuleFiles가 desired bytes보다 오래된 receipt digest를 우선 비교한다. installer와 portable-installer 테스트만 수정한다. 스킬12개는 공개3.9.1 exact bytes로 확인해 공개3.10.0으로 갱신한다. task3은 completed이며 원본 bugs 디렉터리와 중복 기록은 없다. 이 후속 결함은 독립 Bug로 기록한다.

Remote parity: not-required — 공통 portable 설치기이며 화면·프로토콜 변경 없음. 공개3.10.0 assets 및 버전별 계약은 변경하지 않는다.
