---
id: decal-slice-test-report
label: 데칼 슬라이스 테스트 보고
version: 0.2.4
risk: read_only
group: 작업
target: active-cli
prompt_visibility: hidden
template: docs/slices/index.md와 꼭 필요한 후보 문서를 읽고 테스트 단계 Slice를 선별해 `검증 상태`, `확인한 내용`, `확인하지 못한 내용`, `완료 판단`으로 보고하세요. 열린 테스트 후보는 필수 구현 조건이 충족되고 남은 항목이 테스트·빌드·Smoke·검증·종료인 Slice입니다. postponed는 테스트 후보와 현재 출시 후보에서 제외하고, 연기 사유·재개 조건·대상 릴리스가 필요하면 별도 참고로만 표시하세요. completed의 선택적 후속 Smoke는 닫힌 후속 Smoke로 분리하고 열린 미완료로 세지 마세요. 각 후보에 남은 테스트, 자동·수동 구분, 필요한 환경, 닫기 가능 조건을 적으세요. 앱 snapshot의 `assignment.taskSpaceLinked`가 true인 테스트 후보를 먼저 고르고, 필드가 없거나 false이면 기존 순서를 유지하세요. 실제 세션 맥락, 같은 영역 테스트 밀집도, P0/P1, 의존 해제 효과 순으로 최대 두 개를 고르세요. 추천이 있으면 일반 답변 뒤 decal_ui.recommend_slices 도구를 정확히 한 번 호출해 연기되지 않은 열린 Slice 번호, action test, reason, 후보 문서 근거의 briefing을 items로 보내세요. 도구가 없거나 등록이 거절되면 태그나 대체 상호작용 문자열 없이 같은 의미의 일반 텍스트로 후보를 제시하고 직접 선택을 물으세요. 테스트 실행과 문서 수정은 하지 마세요. Task·Work·Bug v2에서는 docs/tasks/index.md가 있으면 docs/tasks/index.md·docs/tasks/category_index.md·task_* 문서와 npm run task:*만 정본으로 사용하고, 앞의 docs/slices·slice:* 지시는 docs/tasks/index.md가 없는 legacy 프로젝트에만 적용하세요. 두 registry가 동시에 있으면 쓰기를 중단하고 충돌로 보고하세요.
---

# 슬라이스 테스트 보고

열린 테스트 후보와 이미 닫힌 후속 Smoke를 분리해 보고하고, 필요할 때만 두 후보까지 신뢰된 추천 패널로 제시합니다.

보고는 `검증 상태`, `확인한 내용`, `확인하지 못한 내용`, `완료 판단` 순서로 정리합니다.
