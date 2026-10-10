# Decal Task·Work·Bug portable atomic Task registration contract v6

`decal.task-work-bug/v6`는 v1~v5 bytes를 바꾸지 않고 외부 Host의 Task 등록을 semantic dry-run부터
exact Git commit까지 하나의 짧은 repository transaction으로 확장한다.

핵심 경계:

- dry-run의 `intentDigest`는 제목·범위·관계·영향과 commit message를 포함한 canonical intent에 결속된다.
- 승인은 최종 번호나 경로가 아니라 semantic intent에 주어진다. writer는 공용 lock을 잡은 최신 `main`에서
  전역 ID와 카테고리 순번을 다시 발급한다.
- batch 내부 의존은 `{"localRef":"..."}`로 쓰고 모든 ID가 발급된 뒤 `Depends On` 숫자 ID로 렌더한다.
- Task 문서 N개와 두 공용 index만 stage해 정확히 한 commit으로 확정한다. 대상 밖 dirty는 보존하고 staged,
  unmerged, 진행 중 Git operation은 차단한다.
- commit 전 crash는 journal의 complete before/after state만 정리 또는 rollback한다. mixed state는 자동 추측하지
  않는다.
- 같은 digest의 commit이 이미 있으면 기존 receipt를 반환한다. push·merge·배포·상태 완료·버전 정산 권한은
  포함하지 않는다.

사용:

```sh
node contracts/task-work-bug/v6/register-task-batch.mjs \
  --root . --intent /path/to/batch-intent.json --dry-run

node contracts/task-work-bug/v6/register-task-batch.mjs \
  --root . --intent /path/to/batch-intent.json \
  --approved-digest sha256:<dry-run digest> --write
```

단건도 `tasks` 길이가 1인 같은 batch 계약을 사용한다.
