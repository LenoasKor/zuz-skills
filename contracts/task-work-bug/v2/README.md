# Decal Task·Work·Bug canonical migration contract v2

이 디렉터리는 `decal.task-work-bug/v2`의 교환 가능한 Phase 1 package다.

- 정본 설명: `docs/task_work_bug_contract_v2.md`
- `contract.json`: v2 경로·token·입력 profile과 ID mapping 규칙
- `unattendedDevelopment: allowed`: Task·Work·Bug 원본에 저장되는 유일한 야간 개발 opt-in 값. 누락·알 수 없는 값은 `manual`로 fail-closed
- `fixtures/project/`: v1 Task, canonical Work, legacy WorkItem을 함께 가진 read-only 입력
- `expected-dry-run.json`: 원문·절대경로 없는 결정적 mapping 예상값
- `acceptance-cases.json`: future schema, symlink, 중복·stale·target 충돌의 공통 결과
- `schemas/migration-manifest.schema.json`: 승인 뒤 writer가 고정할 portable manifest
- `manifest.json`: 이 README를 포함한 package 파일의 SHA-256

이 package는 writer가 아니다. Jig가 `accepted`를 반환하고 사용자가 프로젝트별 preview generation을
별도로 승인하기 전에는 실제 Task·Work·Bug 파일을 이동·수정하지 않는다.

```sh
node scripts/task_work_bug_v2_inventory.mjs --root <project-root>
```

CLI는 `eligible`이면 0, fail-closed `blocked`이면 2, 사용법·실행 오류이면 1로 종료하며 어떤 경우에도
프로젝트 파일을 쓰지 않는다.

한 번의 미리보기에서 `include_all_ready`를 선택해도 이 portable metadata는 수정되지 않는다.
