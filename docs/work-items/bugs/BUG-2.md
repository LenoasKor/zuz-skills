---
schema: decal.task-work-bug.bug-card
schemaVersion: 1
id: BUG-2
title: "LAN 연결이 첫 응답자를 믿고 POSIX 키 저장이 약한 문제"
status: in_progress
priority: P1
taskRefs:
  - "1"
versionImpact: none
remoteVersionImpact: none
releaseMode: standalone
releaseTaskRef: null
versionApplied: not-required
remoteVersionApplied: not-required
createdAt: "2026-10-31T03:59:07.004Z"
updatedAt: "2026-10-31T03:59:48.923Z"
blocked: null
completion: null
closure: null
---

## 사용자 요약

- 이유: LAN 연결(pair)이 처음 응답한 기기를 그대로 믿어, 프로젝트 ID를 아는 다른 기기가 스스로 승인하면 메인 기기에 카드가 뜨지 않아도 연결 완료가 되고, 이후 그 기기가 주는 커밋이 main에 합쳐진다. macOS·Linux의 키 파일 저장도 권한·symlink 검사가 없고 Git 제외 장치가 없다.
- 목표: 새 계약 v24에서 응답자가 둘 이상이면 멈추고, 승인 응답만으로 연결을 활성화하지 않으며, 키 파일 저장과 읽기를 안전하게 하고 키가 Git에 들어가지 않게 한다. v19 네트워크 형식은 유지한다.
- 완료 기준: 위조 자가 승인이 확인 단계 없이 활성화되지 않음, 틀린 코드 거부, 복수 응답 실패와 --authority 동작, 만료, pending 상태 미연결 처리, v19·v23 권한자와 양방향 호환, POSIX symlink·넓은 권한 거부, exclude 등록과 추적 파일 거부를 실제 시험으로 확인.
- 다음 행동: v24를 브랜치에서 구현·검증하고 Pack 3.11.1 후보로 올린다. 병합·태그·발행은 별도 승인.

## 진단과 범위

1. v23/lan-client.mjs pair()는 discoverAuthority의 첫 응답자를 고른다. 승인 태그는 그 응답자와 공유한 세션 키로 계산되므로 자가 승인으로 통과하고, 키가 .decal/its-lan-client.json에 저장된다. 이후 applyBundle(v18)이 그 응답자의 커밋을 클라이언트 main에 합친다.
2. v18/authority-common.mjs writePrivateJson은 macOS·Linux에서 기본 권한 mkdir, 생성 시에만 적용되는 mode 0600 writeFile을 쓰고 symlink를 따라가며 원자적이지 않다. 읽을 때 권한 검사가 없다. v22·v23은 Windows만 강화했다. .decal/its-lan-client.json이 Git에서 제외되지 않는다.

기존 기록 확인: BUG-1(설치기 영수증)과 원인이 다르고, Task 1·2는 계약 편입과 pairing_required 안내 범위다. 공개된 v1~v20·v22·v23 bytes는 바꾸지 않고, v21은 Decal 저장소 소유라 쓰지 않으며, 새 번호는 v24다. 번들 병합 경로 제한은 넣지 않는다. 권한자의 main에 다른 커밋이 정상적으로 포함되기 때문이다.

버전: Pack 3.11.1 올림은 이 수정 안에서 사용자 지시로 직접 하므로 versionImpact는 none으로 두고 별도 출시 정산으로 다시 올리지 않는다.

Remote parity: not-required — portable CLI 계약과 파일 저장 변경이며 Decal Remote 화면·프로토콜 변경 없음.
