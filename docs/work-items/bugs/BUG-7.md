---
schema: decal.task-work-bug.bug-card
schemaVersion: 1
id: BUG-7
title: "등록 잠금이 소유자가 끝나는 순간을 죽은 소유자로 오판해 등록을 거절하는 문제"
status: confirmed
priority: P2
taskRefs:
  - "1"
versionImpact: none
remoteVersionImpact: none
releaseMode: standalone
releaseTaskRef: null
versionApplied: not-required
remoteVersionApplied: not-required
createdAt: "2026-11-01T11:31:35.851Z"
updatedAt: "2026-11-01T11:41:47.991Z"
blocked: null
completion: null
closure: null
---

## 사용자 요약

```zuz-its-context
{
  "schemaVersion": 1,
  "reason": "등록이 동시에 몰릴 때, 앞선 등록이 잠금을 풀고 끝난 직후에 소유자를 확인하면 살아 있는 등록 흐름인데도 repository_lock_owner_terminated로 거절합니다. Windows 전체 시험에서 8건 중 1건이 이렇게 거절됐습니다.",
  "goal": "앞선 등록이 끝나는 순간과 겹쳐도 등록이 차례대로 진행되고, 소유자가 정말 죽어 잠금이 남은 경우는 전처럼 거절됩니다.",
  "completion": "- 고정 입구가 이 거절을 정해진 횟수 안에서 다시 시도합니다.\n- 소유자가 죽고 잠금이 남아 있으면 결국 같은 코드로 거절되고 잠금 파일이 그대로 남습니다.\n- 번호 서버 경유 등록도 같습니다.\n- 수정을 빼면 새 시험이 실패합니다.",
  "nextAction": "담당 AI가 입구의 재시도 대상에 이 거절을 더하고 시험을 추가합니다."
}
```

## 관찰

2026-11-01 Windows의 dfd5159 전체 npm test에서 tests/capability-entry.test.mjs 3b(입구를 거치는 8건 동시 등록)가 7건 등록, 1건 거절로 실패했습니다. 거절 코드는 repository_lock_owner_terminated입니다. Rust 빌드와 겹친 실행이었습니다. 같은 코드는 그 전 Windows 92a27e0의 lan-pairing-v19 반복 실행에서도 나왔습니다. Mac에서는 아직 재현하지 못했습니다.

## 기대 동작

소유자가 정상 해제하고 끝나는 순간과 겹친 등록은 잠금을 다시 잡아 진행합니다. 소유자가 죽고 잠금이 남아 있으면 거절하고 잠금을 건드리지 않습니다.

## 원인

v15·v25 registration-lock.mjs는 잠금 내용을 읽은 뒤 process.kill(pid, 0)을 부르고, ESRCH이면 잠금을 다시 읽지 않고 거절합니다. 읽기와 확인 사이에 소유자가 해제하고 끝나면 이미 없는 잠금을 이유로 거절합니다. 3b에서 나머지 7건이 등록됐으므로 잠금이 남아 있던 것은 아닙니다. 코드와 이 결과로 판단한 원인이며 재현 측정은 아직 없습니다.

## 수정 계획

발행된 계약 bytes는 고칠 수 없으므로 BUG-5와 같이 고정 입구 its-register.mjs의 재시도 대상에 이 코드를 더합니다. 잠금 획득은 쓰기보다 먼저라 다시 시도해도 안전합니다. 번호 계약을 직접 부르는 경로와 이미 설치된 프로젝트는 이 수정으로 고쳐지지 않으며, 잠금 코드 자체는 다음 잠금 계약에서 고칩니다.

## 재사용 판단

BUG-3(Windows EPERM), BUG-4(미리보기의 스테이징 오인), BUG-5(첫 확인의 link 수 오판)를 확인했습니다. 잠금 경합이라는 점은 BUG-5와 비슷하지만 거절 코드와 판정 위치가 다르고 BUG-5의 수정으로 막히지 않습니다. BUG-5는 이미 development_complete라 새 기록으로 분리합니다.

Remote parity: not-required — portable CLI 입구 내부 재시도이며 Decal Remote 화면·프로토콜 변경이 없습니다.
