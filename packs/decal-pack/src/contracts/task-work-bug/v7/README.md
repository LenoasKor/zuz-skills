# ZUZ ITS portable atomic ticket registration contract v7

v7은 기존 Task v6 발급 계약을 유지하면서 Work·Bug·Incident 생성에도 같은 canonical default branch 원자 발급 경계를 적용한다.

- AI와 외부 Host는 최종 ID나 경로가 없는 semantic intent만 제안한다.
- dry-run은 영향과 digest만 반환하고 최종 번호는 승인 후 공용 저장소 잠금 안에서 발급한다.
- 발급기는 canonical default branch에서 종류별 번호 공간을 읽고 정본을 검증한 뒤 정확한 한 경로만 commit한다.
- canonical default branch는 `origin/HEAD`가 실제 원격 ref와 일치하는 `origin/main` 또는 `origin/master`를 가리키고 같은 로컬 branch가 있을 때 그 이름을 우선한다. `origin/HEAD` ref 자체가 없는 로컬 전용 저장소에서만 로컬 `main`/`master` 중 정확히 하나인 후보로 fallback한다.
- feature branch, detached HEAD, 후보 없음, 원격 기준 없이 로컬 `main`과 `master`가 함께 있는 모호한 저장소, non-symbolic 또는 지원하지 않는 `origin/HEAD`, 허용된 이름의 dangling `origin/HEAD`, 대응 로컬 branch가 없는 원격 기본 branch는 fail-closed한다.
- 같은 intent digest는 기존 commit 영수증을 재사용한다.
- crash journal은 commit 전 부분 파일을 원복하고 commit 후 재시도에는 기존 영수증을 반환한다.
- push·merge·deploy·lifecycle 완료·버전 정산은 승인 범위가 아니다.

Task 등록은 v6의 원자 transaction을 보존한 `v7/register-task-batch.mjs`를 사용한다. dry-run에서는 최종 번호를 숨기고, 기존 Task ID 의존성의 재검증 오류도 교정했다. Work·Bug·Incident writer와 동일한 저장소 잠금을 사용하므로 서로 동시에 실행되어도 순차 처리된다.

```sh
node contracts/task-work-bug/v7/register-ticket.mjs --root . --intent /path/to/intent.json --dry-run
node contracts/task-work-bug/v7/register-ticket.mjs --root . --intent /path/to/intent.json --approved-digest sha256:... --write
```
