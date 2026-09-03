# Decal Task·Work·Bug registry acceptance contract v3

`decal.task-work-bug/v3`는 v2의 canonical 저장 경로와 문서 profile을 유지하면서 Task index의 writer 출력과 consumer acceptance를 명시한다.

- `contract.json`: v2 의존 digest, canonical 5열, 숫자 Task ID와 typed rejection
- `acceptance-cases.json`: writer·Decal·Jig가 공유하는 수용 행렬
- `fixtures/project/`: 실제 consumer scan에 사용하는 최소 canonical 프로젝트
- `fixtures/malformed/`: 접두어 ID와 열 누락을 각각 재현하는 index
- `expected-projection.json`: 경로·원문 없는 수용 결과
- `validate-task-index.mjs`: 프로젝트를 쓰지 않는 portable registry validator
- `manifest.json`: 이 README를 포함한 package 파일의 SHA-256

v1/v2 package bytes는 변경하지 않는다. v3 consumer는 v1/v2 문서를 계속 읽되 registry index의 구조는 이 package의 acceptance profile로 검증한다. malformed 입력을 자동 보정하거나 조용히 건너뛰지 않는다.

```sh
node contracts/task-work-bug/v3/validate-task-index.mjs --root .
```
