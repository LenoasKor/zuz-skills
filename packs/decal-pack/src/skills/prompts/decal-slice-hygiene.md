---
id: decal-slice-hygiene
label: 데칼 슬라이스 건강검진
version: 0.2.3
risk: read_only
group: 작업
target: active-cli
prompt_visibility: hidden
template: Task·Work·Bug v2에서는 docs/tasks/index.md·docs/tasks/category_index.md·task_* 문서와 npm run task:*를 정본으로 사용하고, docs/tasks/index.md가 없을 때만 docs/slices와 slice:*를 이전 방식(legacy)으로 사용하세요. 두 registry가 동시에 있으면 쓰기를 중단하고 충돌로 보고하세요. 선택한 정본의 건강 상태를 읽기 전용으로 점검하세요. 인덱스·문서의 상태·제목·개수 불일치, 오래 방치된 진행 작업, 허용되지 않은 상태 전이, blocked·postponed 필수 조건 누락, 개발 완료·출시 준비·완료 상태의 검증과 버전 누락, 완료 기록과 열린 상태의 모순, Version Impact·Context Budget·App.tsx 영향 계획 누락, 중복 번호·깨진 링크·대체·보류 관계 미정리, 닫힌 상태가 실행 후보로 남은 문제를 확인하세요. Slice 341 이후에는 카테고리 등록부와 header·metadata·파일명·index 링크 제목 일치도 확인하되 이전 문서는 새 형식 위반으로 판정하지 마세요. 앱 snapshot의 `assignment.taskSpaceLinked`가 true인 열린 항목은 같은 심각도의 점검·정리 후보 가운데 먼저 확인하고, 필드가 없거나 false이면 기존 순서를 유지하세요. 이전 `complete` 상태와 완료 뒤 선택적 Smoke는 그 사실만으로 결함으로 판정하지 마세요. 출력은 `전체 상태` 아래 점검 범위, `발견 사항`, `권장 순서`로 정리하세요. 발견 사항은 심각도와 확정·의심을 구분하고 상황과 근거를 한 문장으로 합치며, 근거는 짧은 Task 이름과 문서 링크만 표시하세요. 권장 항목은 최대 5개로 제한하고 자동 수정하지 마세요.
---

# 슬라이스 건강검진

Slice 운영 체계의 문서 일관성을 읽기 전용으로 진단합니다.

## 점검

- 인덱스와 개별 문서의 상태·제목 불일치
- 상태 요약 개수 오류와 중복 번호·깨진 링크
- 오래 방치된 `in_progress`와 현재 상태에 맞지 않는 다음 액션
- 허용되지 않은 상태 전이, `blocked`의 `Blocked From`·사유·해제 조건 누락, `postponed`의 `Postponed From`·사유·재개 조건·대상 릴리스 누락
- `development_complete`의 자동 검증 근거, `release_ready`의 릴리스·앱 적용 게이트, `completed`의 필수 검증·`Version Applied` 누락
- 완료 확인 기록이 있는데 열린 상태로 남아 재테스트 후보가 되는 모순
- `Version Impact`, `Version Applied`, `Context Budget`, `App.tsx 영향 계획` 누락
- Slice 341 이후 `Slice Category`·`Category Index` registry, header·metadata·파일명·index 링크 제목 불일치
- 대체·보류 관계가 정리되지 않은 Slice
- `postponed`, `archived`, `deprecated`가 실행 후보로 남은 문제

선택적 후속 Smoke가 남은 `completed`는 그 사실만으로 결함으로 판정하지 않습니다.

legacy `complete`는 읽기 호환으로 허용하며, 기존 문서에 남아 있다는 이유만으로 결함으로 판정하지 않습니다.

Slice 340 이하의 legacy 문서는 새 카테고리 식별 규약 위반으로 판정하지 않습니다.

## 출력

- **전체 상태**: 전체 판단과 그 아래 점검 범위
- **발견 사항**: 문제마다 심각도와 확정·의심 구분. 상황과 근거를 한 문장으로 합치고 근거는 짧은 Task 이름과 문서 링크만 표시
- **권장 순서**: 우선 정리할 항목 최대 5개

완료 확인 기록과 열린 상태의 모순은 재테스트가 아니라 즉시 상태 정산 대상으로 판정합니다.

자동 수정하지 않습니다.
