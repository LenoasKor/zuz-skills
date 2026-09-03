# Decal Task·Work·Bug portable authoring contract v4

`decal.task-work-bug/v4`는 v3 registry acceptance를 그대로 계승하고, 외부 host에서도 사용할 수 있는 결정적 Task 등록 writer를 추가한다.

- `registry.mjs`: v1~v4 package와 숫자 시작 5열 registry를 검증하는 공유 구현
- `validate-task-index.mjs`: 쓰지 않는 reader/writer readiness 검사
- `register-task.mjs`: intent를 검증하고 정확한 Task 문서·index·category index 세 경로만 작성
- `transition-task.mjs`: repository lifecycle script가 없는 portable 프로젝트의 `planned → in_progress` 착수 전이를 정확한 두 경로로 수행
- `fixtures/`: Task 1에서 시작하는 portable registry와 Task 2 등록 intent
- `expected-registration.json`: 결정적 identity·write-set 기대값
- `manifest.json`: 이 README를 포함한 package 파일 SHA-256

v1/v2/v3 package bytes는 수정하지 않는다. v4 writer는 먼저 dry-run으로 `sourceRevision`과 발급 identity를 반환하며, 실제 쓰기에는 그 revision과 `--write`가 모두 필요하다.

```sh
node contracts/task-work-bug/v4/register-task.mjs \
  --root . \
  --intent contracts/task-work-bug/v4/fixtures/task-2-intent.json \
  --dry-run

node contracts/task-work-bug/v4/register-task.mjs \
  --root . \
  --intent /path/to/approved-intent.json \
  --expected-source-revision sha256:<dry-run revision> \
  --write
```

validator는 writer가 아니다. `register-task.mjs` 이외의 도구가 기존 index 모양을 추측해 행을 직접 추가해서는 안 된다.
Jig처럼 역사적 v1/v2 consumer digest를 보존하는 reader는 `validate-task-index.mjs --root . --mode consumer-read-only`를 사용하며 결과의 `authoringStatus`는 `reader-only`다. `register-task.mjs`는 이 모드로 완화되지 않는다.
