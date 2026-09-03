# Decal Task·Work·Bug canonical contract v1

이 디렉터리는 `decal.task-work-bug/v1`의 교환 가능한 canonical package다.

- 정본 설명: `docs/task_work_bug_contract_v1.md`
- Task fixture: 기존 `docs/slices` 저장 profile
- Work fixture: `decal.task-work-bug.work-document`, schema version 1
- Bug fixture: `decal.task-work-bug.bug-card`, schema version 1
- `expected-projection.json`: 소비자가 노출해야 할 경로 없는 최소 projection
- `acceptance-cases.json`: stale·future version·잘못된 전이·symlink·중복 ID의 공통 결과
- `manifest.json`: 이 README를 포함한 package 파일의 SHA-256

새 문서는 Desktop/Remote 영향, standalone/task-batch 출시 방식과 적용 버전을 명시한다. 기존 v1 문서에 이 additive 필드가 없으면 legacy 비정산 이력으로 읽고 소급 버전 상승을 만들지 않는다.

Primer는 이 package의 바이트 동일 사본과 consumer 회귀를 소유한다. runtime에서 Decal checkout을 읽지 않는다. 수용 결과는 `accepted`, `needs_changes`, `unsupported_version` 중 하나로 응답한다.

새 writer는 Work에 `WORK-*`, Bug에 `BUG-*`를 발급한다. 기존 `zuz.project-work-ledger.work-item` 문서는 legacy adapter로 읽고 문서별 사용자 승인 없이 변환하지 않는다.
