---
schema: decal.task-work-bug.bug-card
schemaVersion: 1
id: BUG-4
title: "동시 등록 중 미리보기가 다른 등록의 스테이징을 사용자 변경으로 오인해 거절하는 문제"
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
createdAt: "2026-11-01T03:40:20.155Z"
updatedAt: "2026-11-01T04:35:06.500Z"
blocked: null
completion:
  summary: "fix/flaky-test-locks 05d0e9c. 입구가 staged 거절을 잠금 아래서 재확인, 번호 서버 경유는 재전송. 미리보기 186회 거절 0(수정 전 138회 중 10회). 브랜치 미병합."
  evidence:
    - "부하 전체 시험: 수정본(067e2ed) 8회 실패 0, 수정 전 a01a5a1 14회 중 4회 실패, cd2520c 6회 중 2회 실패. 횟수가 적어 통계적 증명은 아님."
    - "capability-entry 시험 7~9 추가, 새 시험 7은 옛 입구에서 실패 확인, verify:source 통과"
  completedAt: "2026-11-01T04:35:06.500Z"
closure: null
---

## 사용자 요약

```zuz-its-context
{
  "schemaVersion": 1,
  "reason": "다른 AI가 같은 프로젝트에 번호를 등록하는 아주 짧은 순간에 미리보기나 번호 서버 경유 등록을 하면, 사용자가 스테이징한 파일이 없는데도 staged_changes_present로 거절됩니다. 잘못 기록되지는 않지만, 없는 문제를 안내해 AI가 다른 등록의 index를 건드리게 만들 수 있습니다.",
  "goal": "다른 등록이 끝나면 미리보기와 번호 서버 경유 등록이 정상 진행되고, 정말 스테이징된 변경이 있을 때만 거절됩니다.",
  "completion": "- 동시 등록 중 고정 입구의 미리보기에서 staged_changes_present가 0건입니다.\n- 번호 서버가 일시적으로 이 코드로 거절해도 입구가 정해진 횟수 안에서 다시 보냅니다.\n- 진짜 스테이징된 변경은 전처럼 거절됩니다.\n- 발행된 번호 계약 bytes는 그대로입니다.",
  "nextAction": "worktree fix/flaky-test-locks에서 고정 입구를 고치고 회귀 시험을 추가합니다."
}
```

## 관찰

Task 4 전체 시험에서 tests/lan-pairing-v19.test.mjs가 동시 등록 중 staged_changes_present로 1회 실패했습니다. 수정하지 않은 v15로 재현했습니다. 스테이징한 파일이 없는 임시 저장소에서 한 프로세스가 계속 등록하고 다른 프로세스들이 미리보기를 반복했습니다.

- v15 broker: 미리보기 200회 중 6회 거절, 등록 15건은 모두 성공, 끝난 뒤 스테이징 없음
- 고정 입구 its-register.mjs: 미리보기 138회 중 10회 거절, 등록 10건은 모두 성공
- 등록 없이 미리보기만 15초: 202회 모두 통과

## 진단과 범위

미리보기(planTaskRegistrationBatch, planTicketRegistration)는 등록 잠금 없이 git diff --cached를 검사합니다. 쓰는 쪽은 잠금 안에서 git add와 git commit --only 사이에 잠시 index에 스테이징 상태를 만듭니다. 그 순간 미리보기가 검사하면 다른 등록의 변경을 사용자 변경으로 오인합니다. 쓰기의 검사는 잠금 안이라 이 문제가 없습니다.

사용자에게 보이는 경로는 둘입니다. 고정 입구의 --dry-run이 거절되는 경로, 그리고 번호 서버가 registerLocal 안에서 미리보기를 돌려 연결된 기기의 등록을 거절하는 경로입니다. 번호 서버의 직렬 큐는 서버 안의 요청만 줄 세우므로, 같은 기기의 다른 AI가 등록할 때 겹칩니다.

발행 계약 v15·v16·v19·v24·v25·v26은 고칠 수 없으므로 고정 입구에서 해결합니다. 미리보기는 거절을 받으면 등록 잠금을 잡고 한 번 더 확인하고, 연결된 기기는 짧은 간격으로 다시 보냅니다. 번호 계약을 직접 호출하는 경로와 구 설치본은 고쳐지지 않습니다. tests/task-registration-v6.test.mjs의 unsafe_repository_lock은 원인과 경로가 달라 이 Bug에 넣지 않습니다.

기존 기록 확인: BUG-3(Windows EPERM 잠금), BUG-2(LAN 연결 신뢰), BUG-1(설치기 영수증)과 원인·수정이 다릅니다. Task 4의 입구 변경은 이 경로를 지나지 않습니다.

Remote parity: not-required — portable CLI 입구 내부 재시도이며 Decal Remote 화면·프로토콜 변경이 없습니다.

## 작업 기록

2026-11-01 `fix/flaky-test-locks`를 main에 fast-forward로 병합했다(source `a515e230d54a5f99f9faf23484ebcfe4fed35d57`). Pack 3.12.1(`zuz-its` 모듈 1.9.1)과 tag `decal-pack-v3.12.1`을 push하고 GitHub Release를 발행했다. 내려받은 asset이 로컬 빌드와 같다. manifest SHA-256 `dc80b663b97a1f64c7157da902bd2761ea31cfe2a865613ab4bbeb0b1a1f8165`, package SHA-256 `773d75cefaf2181b285c516cfec3e9793ca4889a0051246d9fc698c9e1482770`, manifest identity `34376c5763adc96aaa7c78b2147988ad8893951cac6adf2a999a88ca1a4ec6df`, 346개 파일. 같은 커밋 재빌드 결과가 같다.

부하(CPU 부하 프로세스 30개, load 약 50~90) 전체 시험: source 커밋 8회 모두 308개 통과·실패 0·건너뜀 4. 앞선 수정본 067e2ed도 8회 실패 0. 수정 전 a01a5a1은 14회 중 4회, 변경 전 cd2520c는 6회 중 2회 실패했다. 변경 전 코드에서도 같은 실패가 나왔으므로 Task 4가 원인은 아니며, 새 시험 파일(전체 CPU의 약 2.6%, 단독 실행 기준 추정)이 빈도를 높였다는 근거는 없지만 횟수가 적어 완전히 배제하지는 못한다.

남은 일: Store 공개, 데칼 동기화, 다른 소비 프로젝트 전파, Windows 시험. 번호 계약을 직접 부르는 경로와 구 설치본은 고쳐지지 않는다.
