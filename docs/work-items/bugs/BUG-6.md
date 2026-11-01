---
schema: decal.task-work-bug.bug-card
schemaVersion: 1
id: BUG-6
title: "Pack 설치가 줄바꿈 설정을 넣지 않아 autocrlf clone에서 등록이 거절된다"
status: confirmed
priority: P2
taskRefs: []
nextAction: "담당 AI가 설치기를 고치고 autocrlf clone 시험을 추가합니다."
versionImpact: desktop-patch
remoteVersionImpact: none
releaseMode: standalone
releaseTaskRef: null
versionApplied: pending
remoteVersionApplied: not-required
createdAt: "2026-11-01T08:42:24.236Z"
updatedAt: "2026-11-01T08:50:34.000Z"
blocked: null
completion: null
closure: null
---

## 사용자 요약

```zuz-its-context
{
  "schemaVersion": 1,
  "reason": "프로젝트를 Windows에서 줄바꿈 자동 변환(core.autocrlf)이 켜진 상태로 clone하면 설치된 계약 파일의 줄바꿈이 바뀌어 Task·Work·Bug 등록이 내용 지문 불일치로 거절됩니다. Pack 설치기가 프로젝트에 줄바꿈 설정을 넣지 않아서 생기는 문제입니다.",
  "goal": "Pack을 설치한 프로젝트는 어느 기기에서 clone해도 계약 파일이 LF를 유지해 등록이 진행됩니다.",
  "completion": "- ITS 설치가 프로젝트 .gitattributes에 계약 경로의 eol=lf 줄을 넣습니다.\n- 기존 .gitattributes 내용을 바꾸지 않습니다.\n- 이미 같은 줄이 있으면 파일을 바꾸지 않습니다.\n- core.autocrlf를 켠 clone에서 계약 검증이 통과합니다.",
  "nextAction": "담당 AI가 설치기를 고치고 autocrlf clone 시험을 추가합니다."
}
```

## 관찰

2026-11-01 Decal 저장소 BUG-421에서 재현했다. `contracts/task-work-bug`만 담은 저장소를 `core.autocrlf=true`로 clone하면 파일이 CRLF가 되고, `its-register.mjs --kind ticket --dry-run`이 `authoring_update_required` / `contract_digest_mismatch`로 거절한다. 원본 저장소에서는 `accepted`다. Windows 실제 설치 프로젝트에서 재현하지는 않았다.

## 기대 동작

clone 설정과 상관없이 계약 파일이 LF를 유지한다. 내용이 바뀐 계약은 계속 거절한다.

## 원인

`scripts/install-decal-pack.mjs`는 설치 프로젝트에 줄바꿈 설정을 넣지 않는다. 이 저장소의 `.gitattributes`는 자기 저장소에만 적용된다.

## 수정

ITS 설치 때 프로젝트 `.gitattributes`에 `contracts/task-work-bug/** text eol=lf`를 더한다. 같은 줄이 있으면 그대로 두고, 기존 내용은 바꾸지 않는다. 계약 파일과 검증 방식은 바꾸지 않는다. Decal의 Rust 설치기도 같은 내용을 쓰도록 Decal BUG-421에서 맞춘다.

## 재사용 판단

BUG-3, BUG-4, BUG-5는 잠금과 시험 경합을 다루며 원인이 다르다. 이 경로의 줄바꿈을 다루는 기록은 찾지 못했다.

## 범위

- 설치기의 .gitattributes 처리와 시험.
- 범위 밖: 계약 버전 변경, Pack 버전 확정·tag·Store 공개.

## Remote parity proposal

not_applicable — 설치기의 파일 처리이며 Remote 표면이 없다.

## Context Budget

- 필수: scripts/install-decal-pack.mjs, tests/portable-installer.test.mjs
- 기본 제외: contracts/task-work-bug 계약 본문
