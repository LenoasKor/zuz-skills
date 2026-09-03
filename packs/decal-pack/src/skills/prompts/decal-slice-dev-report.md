---
id: decal-slice-dev-report
label: 데칼 슬라이스 개발진행 보고
version: 0.1.4
risk: read_only
group: 작업
target: active-cli
prompt_visibility: hidden
template: docs/slices/index.md와 필요한 후보 문서를 읽고 구현·수정·문서화가 남은 Slice를 `현재 상황`, `바로 시작할 수 있는 작업`, `먼저 결정이 필요한 작업`, `추천`으로 보고하세요. in_progress 중 구현 완료 조건이 남은 항목과 planned 중 범위·완료 조건·의존성이 충분해 바로 착수 가능한 항목을 구분하세요. blocked, postponed, development_complete, release_ready, 테스트나 공식 종료만 남은 항목은 개발 후보에서 제외하고 이유를 짧게 표시하세요. postponed는 사용자가 재검토를 명시하기 전까지 현재 출시·개발 추천에 포함하지 마세요. 각 후보에 남은 개발 범위, 선행 의존성, 충돌 가능 파일, 현재 착수 가능 여부를 적으세요. 앱 snapshot의 `assignment.taskSpaceLinked`가 true인 개발 후보를 먼저 고르고, 필드가 없거나 false이면 기존 순서를 유지하세요. 실제 세션 맥락, P0/P1, 의존성 충족, 후속 작업 효과, 낮은 충돌 위험 순으로 최대 두 개를 고르세요. 추천이 있으면 일반 답변 뒤 decal_ui.recommend_slices 도구를 정확히 한 번 호출해 연기되지 않은 열린 Slice 번호, action develop, reason, 후보 문서 근거의 briefing을 items로 보내세요. 도구가 없거나 등록이 거절되면 태그나 대체 상호작용 문자열 없이 같은 의미의 일반 텍스트로 후보를 제시하고 직접 선택을 물으세요. 구현과 상태 변경은 하지 마세요. Task·Work·Bug v2에서는 docs/tasks/index.md가 있으면 docs/tasks/index.md·docs/tasks/category_index.md·task_* 문서와 npm run task:*만 정본으로 사용하고, 앞의 docs/slices·slice:* 지시는 docs/tasks/index.md가 없는 legacy 프로젝트에만 적용하세요. 두 registry가 동시에 있으면 쓰기를 중단하고 충돌로 보고하세요.
---

# 슬라이스 개발진행 보고

실제 개발이 남은 Slice와 바로 착수 가능한 Slice를 분리해 보고하고, 필요할 때만 두 후보까지 신뢰된 추천 패널로 제시합니다.

보고는 `현재 상황`, `바로 시작할 수 있는 작업`, `먼저 결정이 필요한 작업`, `추천` 순서로 정리합니다.
