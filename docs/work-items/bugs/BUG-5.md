---
schema: decal.task-work-bug.bug-card
schemaVersion: 1
id: BUG-5
title: "맥의 v15 잠금이 해제 순간을 위험한 잠금으로 오판해 등록을 거절하는 문제"
status: development_complete
priority: P2
taskRefs:
  - "1"
versionImpact: none
remoteVersionImpact: none
releaseMode: standalone
releaseTaskRef: null
versionApplied: not-required
remoteVersionApplied: not-required
createdAt: "2026-11-01T04:08:10.013Z"
updatedAt: "2026-11-01T04:35:08.075Z"
blocked: null
completion:
  summary: "fix/flaky-test-locks 067e2ed. 입구가 v15 unsafe 거절을 정해진 횟수만 재시도. 진짜 위험한 잠금은 거절 유지. 브랜치 미병합."
  evidence:
    - "부하 전체 시험: 수정본(067e2ed) 8회 실패 0, 수정 전 a01a5a1 14회 중 4회 실패, cd2520c 6회 중 2회 실패. 횟수가 적어 통계적 증명은 아님."
    - "capability-entry 시험 7~9 추가, 새 시험 7은 옛 입구에서 실패 확인, verify:source 통과"
  completedAt: "2026-11-01T04:35:08.075Z"
closure: null
---

## 사용자 요약

```zuz-its-context
{
  "schemaVersion": 1,
  "reason": "맥에서 쓰는 v15 등록 잠금은 앞선 등록이 잠금을 푸는 순간을 안전하지 않은 잠금으로 오판해 unsafe_repository_lock으로 거절합니다. 드물지만 사용자가 승인한 등록이 쓰기 전에 실패합니다. 아무것도 기록되지 않습니다.",
  "goal": "잠금이 풀리는 순간과 겹쳐도 등록이 차례대로 진행되고, 심볼릭 링크나 망가진 잠금처럼 진짜 위험한 잠금은 전처럼 거절됩니다.",
  "completion": "- 고정 입구가 이 거절을 정해진 횟수 안에서 다시 시도합니다.\n- 계속 위험한 잠금은 결국 같은 코드로 거절되고 잠금 파일이 그대로 남습니다.\n- 번호 서버 경유 등록도 같습니다.\n- 발행 계약 bytes와 플랫폼별 계약 선택은 그대로입니다.",
  "nextAction": "worktree fix/flaky-test-locks에서 BUG-4와 같은 재시도 지점에 추가합니다."
}
```

## 관찰

변경 전 코드 clone(a01a5a1)의 부하 전체 시험에서 tests/preserving-registration-lock.test.mjs의 대기자 시험이 unsafe_repository_lock으로 1회 실패했습니다. 수정하지 않은 잠금 모듈을 프로세스 넷이 150회씩 잡고 푸는 시험을 두 번 돌리면, v15는 1,200회 중 3회 거절됐고 v25는 0회였습니다. 프로세스 둘씩 300회(600회)에서는 둘 다 0회였습니다.

## 진단과 범위

v15 inspect는 파일을 두 번 봅니다. 그 사이 보유자가 잠금을 풀면 link 수가 0이 되거나 inode가 바뀌는데, 이를 안전하지 않은 잠금으로 처리합니다. v25 README가 설명하고 고친 경합과 같습니다. BUG-3는 v25를 Windows에만 선택했으므로 맥과 Linux는 v15에 남아 있고, 번호 서버 broker는 v15를 직접 부릅니다.

v25로 바꾸는 대신 입구에서 다시 시도합니다. BUG-3의 플랫폼 선택을 유지하고, 계약을 직접 고르는 번호 서버 경로까지 함께 해결됩니다. 잠금 획득은 쓰기보다 먼저라 이 거절 뒤 다시 시도해도 안전합니다. 번호 계약을 직접 호출하는 경로와 구 설치본은 고쳐지지 않습니다.

기존 기록 확인: BUG-4(미리보기의 스테이징 오인)와 원인과 코드가 다르고, BUG-3(Windows EPERM)와 증상이 다릅니다. tests/task-registration-v6.test.mjs의 실패는 v6 자체의 다른 코드(ENOENT, 빈 파일)이며 입구가 쓰지 않습니다.

Remote parity: not-required — portable CLI 입구 내부 재시도이며 Decal Remote 화면·프로토콜 변경이 없습니다.

## 작업 기록

2026-11-01 부하 시험에서 `tests/registration-lock-v25.test.mjs`가 수정 전 코드에서 1회 실패해 v25 잠금도 조사했다. 측정용 사본(첫 번째 확인의 거절에 관측값 출력만 추가)으로 8개 프로세스 30회 시험을 반복하니, 부하 없음 3,600회에서는 0회, CPU 부하 프로세스 30개에서는 6,000회 중 1회 `lstat`이 `nlink 0, size 97`을 돌려주었다. 보유자의 unlink가 진행되는 순간의 정상 잠금이다. v25는 두 번째 확인의 경합만 고쳤고 첫 번째 확인의 `before.nlink !== 1`이 남아 있다. 위 진단의 "v25는 0회"는 그 시험의 횟수 안에서만 맞다. v15에도 같은 첫 번째 확인이 있으나 그 경로로 실패한 것을 직접 관측하지는 않았다.

고정 입구의 재시도가 계약과 무관하게 이 거절을 처리하므로 입구는 더 바꾸지 않고 시험만 고쳤다. 다음 번호 계약에서 잠금을 새로 낼 때 첫 번째 확인의 link 수 0도 경합으로 처리해야 한다. 발행 기록은 BUG-4를 본다.

2026-11-02 Store 공개(`decal-project-pack-r28`)와 데칼 main 반영(`6b61ed940`)을 확인했다. 수정이 든 e82db7f를 Windows 전체 npm test로 돌린 결과는 BUG-7에 기록돼 있다(세션 기록 기준, 직접 실행 아님). 다른 소비 프로젝트 전파는 프로젝트별 갱신으로 남기고 이 결함의 종결 조건에 넣지 않는다. 번호 계약 직접 호출과 구 설치본은 고쳐지지 않는다.
