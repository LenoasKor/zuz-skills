---
id: decal-slice
label: 데칼 작업 분할
version: 0.4.6
risk: read_only
group: 작업
target: active-cli
template: 현재 목표나 요청된 작업을 30분 이내에 검증 가능한 단위로 쪼개주세요. 각 슬라이스마다 1) 작업 내용 2) 완료 조건 3) 위험 여부를 표시하고, 의존 관계 순서대로 정렬해주세요. 새 Decal Slice 제안에는 category·영문 slug·title·priority·areas·summary·Context Budget을 포함한 body·version/Remote impact를 제시하되, 전역 번호·Category Index·최종 파일명은 충돌 가능한 임시 추정값으로 만들지 마세요. Primer WorkSlice 정보가 명시적으로 제공된 경우에는 workSliceId와 원본 title을 보존하고 Primer Slice를 새 Decal Slice로 바꾸거나 완료 처리하지 마세요. 계획 끝에는 여러 turn의 중단기 작업인지, 자주 수정되는 파일이나 다른 세션과 충돌할 가능성이 큰지 판단하세요. 먼저 DECAL_SESSION_ID 존재 여부로 host를 판정하세요. 분리가 필요하면 Decal 소유 세션에서는 이유와 goal·reason·completionCriteria·scope·exclusions를 decal_ui.propose_task_space에 한 번 제출하고, 외부 Codex/CLI host에서는 Native 패널을 가장하지 않고 같은 내용을 일반 텍스트와 portable handoff로 제안하세요. 이 단계에서는 실제 작업이나 Git 변경을 하지 마세요. 사용자가 후속 요청에서 실제 생성·등록을 지시하면 Decal 소유 세션은 공용 index/category와 번호가 붙은 파일을 선편집하지 않고 안정된 intentId와 의미 입력만 operation slice_register_intent로 decal_ui.request_slice_maintenance_commit에 한 번 제출하세요. 전용 도구가 없거나 정책이 거절·차단되면 직접 커밋하거나 범용 커밋 경로로 우회하지 말고 host recovery의 phase, cause, retryability, requestState, nextAction을 따르세요. correct_and_retry_same_turn + not_created일 때만 보고된 입력을 고쳐 정확히 한 번 재호출하세요. 외부 Codex/CLI host에서는 decal_ui를 호출하지 않고 사용자의 현재 turn 실제 등록 요청을 canonical 파일 준비 승인으로 봅니다. latest main과 registry/category를 다시 읽어 다음 미사용 번호·카테고리 순번·최종 경로를 재검증하고 Task 문서·index·category index의 정확한 3경로만 같은 transaction 범위로 작성한 뒤 identity·index·version 회귀를 실행하세요. 상태 관리는 공식 task:* 또는 legacy slice:* 명령을 사용하세요. 파일 준비 권한은 커밋 권한이 아니므로 외부 커밋은 정확한 경로의 별도 승인을 요구합니다. 외부 host라는 이유만으로 등록을 거절하지 마세요. Decal 상호작용 패널은 decal_ui 도구 호출로만 만들어지며, 외부 host는 패널을 만들었다고 보고하지 않습니다.
---

# 작업 분할

큰 작업을 30분 단위 검증 가능한 Slice로 쪼개고 의존 관계 순서로 정렬하는 읽기 전용 계획 스킬입니다.

새 Decal Slice 제안에는 등록 intent의 category·slug·title·index metadata·본문·version/Remote impact를 함께 제시합니다. 전역 번호·카테고리 순번·최종 파일명은 latest main을 재검증한 Native가 발급하고, Decal 소유 세션은 그 결과를 사용합니다. 외부 Codex/CLI host는 latest main 재검증과 정확한 3경로 수기 transaction으로 같은 정본을 작성합니다. Primer-origin WorkSlice는 외부 식별자와 제목을 보존하며 Decal의 로컬 Slice와 혼동하지 않습니다.

계획 범위가 다른 작업과 섞이기 쉬운 중단기 작업이면 `decal-task-space` 스킬의 구조화 형식으로 분리 작업을 함께 제안합니다. 제안만으로 Git 상태를 변경하지 않습니다.
