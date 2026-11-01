---
schema: decal.task-work-bug.bug-card
schemaVersion: 1
id: BUG-3
title: "Windows 동시 등록이 잠금 파일 EPERM으로 실패하는 문제"
status: closed
priority: P1
taskRefs:
  - "1"
nextAction: null
versionImpact: none
remoteVersionImpact: none
releaseMode: standalone
releaseTaskRef: null
versionApplied: not-required
remoteVersionApplied: not-required
createdAt: "2026-11-01T01:27:38.153Z"
updatedAt: "2026-11-01T16:04:09.225Z"
blocked: null
completion:
  summary: "Windows 잠금 거부(EPERM)를 v25·v26이 연속 5초까지 재시도해 동시 등록 EPERM이 사라졌다. 3.12.0으로 발행됨."
  evidence:
    - "Windows 92a27e0: capability-entry 3/3 통과. 조용한 상태에서 v25로 8건 동시 로컬 등록(ok 3b) 포함, EPERM·ENOENT 없음."
    - "Windows registration-lock-v25 3회 모두 9/9, task-registration-v7 3/3, lan-pairing-v24 3/3, multi-device-authority-v18 단독 3/3."
    - "Mac e577ee9: 수정 후 multi-device-authority-v18, lan-pairing-v19, capability-entry 통과."
    - "남은 별도 건: lan-pairing-v19 단독 1/3(repository_lock_owner_terminated, queued/TimeoutError, 빌드와 겹침). 이 Bug의 EPERM 아님. 시험 수정 e577ee9의 Windows 재확인은 안 함."
    - "남은 별도 건: 잠금 소유자 종료 판정이 다시 읽지 않고 실패하는 경합 추정, v19 lan-broker가 v15·v16 고정이라 Windows 번호 서버 경로는 v25를 타지 않음."
  completedAt: "2026-11-01T08:10:04.000Z"
closure:
  reason: fixed
  note: null
  duplicateOf: null
  closedAt: "2026-11-01T16:04:09.225Z"
---

## 사용자 요약

- 이유: Windows에서 여러 AI가 동시에 번호를 등록하면 일부가 EPERM으로 실패합니다. 잠금 파일을 지우는 동안 다른 프로세스가 열면 Windows가 "이미 있음" 대신 EPERM을 돌려주는데, 등록 잠금이 이를 곧바로 실패로 처리합니다.
- 목표: Windows에서 동시 등록이 EPERM 없이 차례로 처리됩니다. 진짜 권한 문제는 짧은 한도 뒤 전처럼 실패합니다.
- 완료 기준: Windows 동시 등록 시험에서 EPERM 거절이 사라짐, 새 계약이 Windows에서만 선택됨, 발행된 v15·v16 bytes 불변, Mac 등록 경로 불변.
- 다음 행동: 새 계약 v25·v26을 fix/pairing-trust-v24 브랜치에 구현해 Pack 3.11.1 후보에 포함합니다.

## 관찰

Windows 8개 프로세스 15초 시험: open("wx") EPERM 1,040회, readFile EPERM 1,573회, lstat·unlink 0회. Mac 0회. task-registration-v7 동시 8건 중 1건 rejected/EPERM(3회 중 1회).

## 진단과 범위

v15 registration-lock.mjs는 EEXIST 외 오류를 그대로 던진다. 지우는 중인 파일을 열어 생긴다는 설명은 추정이며 직접 확인하지 않았다. 발행 계약은 고칠 수 없으므로 v15를 잇는 v25, v16을 잇는 v26을 만들고 win32에서만 선택한다. v6~v14, v18, v22의 같은 잠금 파일 사용은 범위 밖이다.

기존 기록 확인: BUG-2(LAN 연결 신뢰·키 저장)와 원인·수정이 다르다. BUG-1(설치기 영수증)과도 다르다.

Remote parity: not-required — portable CLI 계약 내부 재시도이며 Decal Remote 화면·프로토콜 변경이 없다.
