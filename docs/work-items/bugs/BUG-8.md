---
schema: decal.task-work-bug.bug-card
schemaVersion: 1
id: BUG-8
title: "Pack 설치본에서 settlement-profile이 없으면 일반 상태 변경까지 ENOENT로 거절된다"
status: development_complete
priority: P2
taskRefs: []
nextAction: "담당 AI가 새 계약에 일반 상태 변경 경로를 만들고 설치본으로 재현 시험을 돌립니다."
versionImpact: desktop-patch
remoteVersionImpact: none
releaseMode: standalone
releaseTaskRef: null
versionApplied: pending
remoteVersionApplied: not-required
createdAt: "2026-11-01T16:09:37.548Z"
updatedAt: "2026-11-01T16:14:32.000Z"
blocked: null
completion:
  summary: "설치본에서 프로파일이 없어도 Work·Bug 일반 상태 변경이 기록 파일 하나만 커밋하도록 v28을 더했습니다. 버전 정산은 계속 프로파일이 필요합니다."
  evidence:
    - "전체 npm test 323개 통과, 건너뜀 4개, 실패 0개"
    - "설치본 재현: v11 ENOENT, v28 confirmed 전이 커밋"
    - "프로파일이 있을 때 v11과 같은 승인 지문"
  completedAt: "2026-11-01T16:14:32.000Z"
closure: null
---

## 사용자 요약

```zuz-its-context
{
  "schemaVersion": 1,
  "reason": "Pack만 설치한 프로젝트에서 Work·Bug 상태를 바꾸면 .decal/settlement-profile.json이 없다는 이유로 ENOENT 코드만 내고 거절합니다. Pack 설치는 이 파일을 만들지 않으므로, 데칼 밖 에이전트는 설치 직후 상태를 전혀 바꿀 수 없고 이유도 알 수 없습니다.",
  "goal": "버전을 건드리지 않는 일반 상태 변경은 이 파일 없이 진행됩니다. 버전 정산에는 계속 파일이 필요하고, 안내가 그 차이를 분명히 말합니다.",
  "completion": "- 파일이 없는 설치본에서 Work·Bug의 일반 상태 변경이 정확한 파일 한 개만 커밋합니다.\n- 파일이 있으면 지금과 같이 동작하고, repository 엔진은 계속 거절합니다.\n- 깨진 파일, 심볼릭 링크, 낡은 원본, 진행 중인 거래는 계속 거절합니다.\n- 스킬 안내가 새 경로와 버전 정산의 파일 요구를 말합니다.\n- 공개된 이전 계약은 바이트 그대로입니다.",
  "nextAction": "담당 AI가 새 계약에 일반 상태 변경 경로를 만들고 설치본으로 재현 시험을 돌립니다."
}
```

## 관찰

2026-11-01 Windows의 데칼 BUG-408·409 앱 확인에서 공용 `v11/work-item-lifecycle.mjs`가 ENOENT로 거절됐다고 보고됐다. Mac에서 데칼 앱으로 Pack 3.12.1을 설치한 합성 프로젝트의 사본에서 `confirmed` 전이 dry-run으로 재현했다: `{"status":"rejected","code":"ENOENT"}`.

## 원인

`planWorkItemTransition`이 일반 전이에도 `loadProfile`을 부르고, `executePlan`의 `writeMarker`도 파일을 요구한다. 프로파일은 프로젝트가 승인해 버전 원본을 적는 파일이라 설치기는 일부러 만들지 않는다(데칼 설치 시험이 없음을 단언한다). 일반 전이는 버전을 쓰지 않는데도 같은 요구를 받는다.

## 기대 동작

버전을 쓰지 않는 일반 전이는 파일이 없어도 진행한다. 파일이 있으면 지금과 같이 검사하고, `repository` 엔진은 거절한다. 버전 정산은 계속 파일을 요구한다.

## 수정과 검증

브랜치 `fix/bug-8-lifecycle-profile`(28a9b2a), 병합 대기. 공개된 계약은 바꾸지 않고 v28 `work-item-lifecycle.mjs`를 더했다. 프로파일이 있으면 v11을 그대로 실행하고, 파일이 없을 때만 같은 요청·승인 지문·저장소 잠금으로 기록 파일 하나를 커밋한다. 커밋이 실패하면 기록을 되돌린다. `decal-work`·`decal-bug` 스킬(1.16.0) 안내와 `pack.source.json`의 `workItemLifecycle`을 v28로 옮겼다.

- 설치본 재현: 이 브랜치로 만든 패키지를 임시 프로젝트에 설치(`zuz-its`, `claude`)했다. 프로파일이 없고, v11은 `ENOENT`, v28은 `confirmed` 전이가 기록 파일 하나만 커밋했다.
- 새 시험 `tests/work-item-lifecycle-v28.test.mjs`: new에서 closed까지, `.decal` 폴더 없음, 틀린 지문, 낡은 원본, 수정된 기록, 스테이징, 진행 중인 거래, 커밋 실패 복원, 프로파일이 있을 때 v11과 같은 지문, repository 엔진, 깨진 프로파일, 링크된 프로파일, 데칼 소유 세션, 변조된 계약.
- `npm run verify:source` 통과. 전체 `npm test` 327개 중 323개 통과, 건너뜀 4개, 실패 0개.
- 미확인: Windows 실행. 커밋 실패 복원 시험은 Windows에서 건너뛰도록 표시했다. 쓰기 뒤 커밋 전에 프로세스가 죽는 경우는 시험하지 않았고, 다음 시도가 `target_dirty`로 멈추는 것은 수정된 기록 시험으로만 확인했다.
- 남은 일: Pack 버전 확정·tag·Store 공개와 데칼 동기화는 하지 않았다. 그 전까지 기존 설치본에는 적용되지 않는다. 버전 정산과 Task 전이는 계속 프로파일이 필요하고 `ENOENT`로 거절한다.

## 재사용 판단

- BUG-3, BUG-4, BUG-5, BUG-7: 등록 잠금과 스테이징 범위이며 상태 변경 경로가 아니다.
- BUG-6: 줄바꿈 범위이고 종결됐다.
- BUG-1: 설치 영수증 오판, BUG-2: LAN 연결 범위다.
- 전체 Bug 제목과 본문의 `settlement-profile`, `loadProfile` 검색으로 확인했다. 같은 범위의 기록은 없다.

## 범위

- 새 계약 번호의 Work·Bug 일반 전이 입구, 스킬 안내, 시험.
- 범위 밖: 공개된 v1~v27 수정, 버전 정산, Task 전이, Pack 버전 확정·tag·Store 공개, 데칼 동기화.

## Remote parity proposal

not_applicable — 데칼 밖 에이전트가 쓰는 Pack 계약 스크립트이며 Remote 화면이나 계약을 바꾸지 않는다. 데칼 세션의 상태 변경은 Native 도구를 쓴다.

## Context Budget

- 필수: packs/decal-pack/src/contracts/task-work-bug/v11/work-item-lifecycle.mjs, v9/transaction.mjs, v27(새 계약 추가 예)
- 기본 제외: 등록 권한자 프로토콜, Task 등록
