# Decal Task·Work·Bug portable authoring contract v5

`decal.task-work-bug/v5`는 v4의 Task 전용 writer를 Work·Bug로 확장한다. v1~v4 package bytes는 수정하지 않는다.

- `work-items.mjs`: 종류 정의, 상태 흐름, frontmatter 파싱, 안전 경로, 스캔을 담는 공유 구현
- `validate-work-items.mjs`: 쓰지 않는 reader. `authoringStatus`로 `ready`, `update-required`, `malformed`를 구분한다
- `register-work-item.mjs`: intent를 검증하고 정확한 **단일 경로**만 작성한다
- `transition-work-item.mjs`: 종류별 시작 흐름과 공통 후속 흐름을 강제하는 lifecycle writer
- `fixtures/`: WORK-001·BUG-001에서 시작하는 portable registry와 등록 intent
- `manifest.json`: 이 README를 포함한 package 파일 SHA-256

## 핵심 계약

Work·Bug는 **파일 단위 정본**이다. `docs/tasks/index.md`는 Task 전용이며 Work·Bug 행이나 `## Work`,
`## Bugs` 구획을 갖지 않는다. 상위 Task 연결은 각 문서의 `taskRefs`로 표현한다.

```
docs/work-items/work/WORK-<번호>.md
docs/work-items/bugs/BUG-<번호>.md
```

## 사용

writer는 먼저 dry-run으로 발급 identity와 `sourceRevision`을 돌려주며, 실제 쓰기에는 그 revision과
`--write`가 모두 필요하다.

```sh
node contracts/task-work-bug/v5/validate-work-items.mjs --root .

node contracts/task-work-bug/v5/register-work-item.mjs \
  --root . \
  --intent /path/to/approved-intent.json \
  --dry-run

node contracts/task-work-bug/v5/register-work-item.mjs \
  --root . \
  --intent /path/to/approved-intent.json \
  --expected-source-revision sha256:<dry-run revision> \
  --write
```

상태 전이도 같은 revision 결속을 사용한다.

```sh
node contracts/task-work-bug/v5/transition-work-item.mjs \
  --root . --kind work --id WORK-001 --status development_complete \
  --expected-source-revision sha256:<현재 문서 revision> \
  --summary "..." --evidence "..."
```

validator는 writer가 아니다. `register-work-item.mjs`와 `transition-work-item.mjs` 이외의 도구가 기존
문서 모양을 추측해 필드를 직접 고쳐서는 안 된다.

저장소가 자체 lifecycle 스크립트를 갖고 있으면 그것이 우선한다. 이 package는 그런 스크립트가 없는
휴대형 프로젝트를 위한 정본 대체 경로다.
