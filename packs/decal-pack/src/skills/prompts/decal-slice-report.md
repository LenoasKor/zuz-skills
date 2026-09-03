---
id: decal-slice-report
label: 데칼 슬라이스 전체 보고
version: 0.3.4
risk: read_only
group: 작업
target: active-cli
prompt_visibility: hidden
template: 입력 끝에 "Decal app-precomputed Slice snapshot"이 있으면 앱이 이미 전체 현황을 표시했으므로 index를 다시 읽거나 목록을 반복하지 말고 후보만 정리하세요. 없을 때만 docs/slices/index.md를 읽어 in_progress, blocked, development_complete, release_ready, maintained, planned, backlog의 현재 출시 개수와 postponed의 별도 개수·사유·재개 조건·대상 릴리스를 먼저 간결하게 보고하세요. completed, archived, deprecated는 제외하세요. postponed는 개발·계획·테스트·Smoke·현재 출시 추천 후보가 아니며 사용자가 연기 작업 재검토를 명시한 경우에만 후보로 다시 검토하세요. blocked의 사유·해제 조건과 development_complete/release_ready의 남은 게이트를 표시하세요. 앱 snapshot의 `assignment.taskSpaceLinked`가 true인 항목은 명시적으로 연결된 작업 공간을 가진 후보이므로 후보 조건을 충족하는 범위에서 가장 먼저 추천하세요. 필드가 없거나 false이면 기존 순서를 유지하세요. 그 뒤 실제 세션 맥락, P0/P1, 의존 해제, 실행 가능성을 기준으로 필요한 현재 출시 후보 문서만 읽어 최대 두 개를 고르세요. 전체 답변은 `현재 상황`, `바로 시작할 수 있는 작업`, `먼저 결정이 필요한 작업`, `추천`으로 정리하세요. 추천이 있으면 일반 답변 뒤 decal_ui.recommend_slices 도구를 정확히 한 번 호출해 items에 연기되지 않은 열린 Slice 번호, plan/develop/test/smoke action, 짧은 reason, 후보 문서 근거의 briefing을 넣으세요. 도구가 없거나 등록이 거절되면 태그나 대체 상호작용 문자열을 출력하지 말고 같은 의미의 일반 텍스트로 후보를 제시하고 사용자에게 직접 선택을 물으세요. 파일·Git 상태는 변경하지 마세요. Task·Work·Bug v2에서는 docs/tasks/index.md가 있으면 docs/tasks/index.md·docs/tasks/category_index.md·task_* 문서와 npm run task:*만 정본으로 사용하고, 앞의 docs/slices·slice:* 지시는 docs/tasks/index.md가 없는 legacy 프로젝트에만 적용하세요. 두 registry가 동시에 있으면 쓰기를 중단하고 충돌로 보고하세요.
---

# 슬라이스 전체 보고

앱 스냅샷이 있으면 이를 우선 사용합니다. 없을 때만 index 기반 빠른 현황을 먼저 보여주고, 필요한 후보 문서만 읽어 다음 두 후보까지 추천합니다.

보고는 `현재 상황`, `바로 시작할 수 있는 작업`, `먼저 결정이 필요한 작업`, `추천` 순서로 정리합니다.

## 추천 패널

- 추천은 `decal_ui.recommend_slices` 도구로만 패널을 만듭니다.
- 항목은 열린 Slice와 `plan`, `develop`, `test`, `smoke` 중 맞는 action만 포함합니다.
- 도구를 쓸 수 없으면 패널을 흉내 내지 않고 일반 텍스트로 설명합니다.
