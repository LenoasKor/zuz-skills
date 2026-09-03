---
id: decal-task-space
label: 데칼 안전 작업 공간
version: 0.5.2
risk: confirmation_required
group: 작업
target: active-cli
prompt_visibility: hidden
template: 현재 요청이 다른 작업과 변경사항이 섞일 가능성이 큰 중단기 작업인지 읽기 전용으로 판단하세요. branch, worktree, merge, rebase, reset, 삭제는 실행하지 마세요. 분리가 필요하면 목표, 이유, 완료 조건, 포함 범위, 제외 범위를 정리하세요. 명확한 Slice·태스크·버그·QA처럼 부모 세션이 사용자와 계속 소통하면서 독립 실행을 맡길 수 있으면 executionMode를 worker로, workerRole을 짧은 역할명으로 설정하세요. 워커의 모델·추론은 부모 설정 상속이 기본이며, 사용자가 명시적으로 다른 설정을 요청한 경우에만 workerModelHint와 workerResponseMode를 넣으세요. 사용자가 현재 세션 자체를 작업 공간으로 옮기길 원하거나 작업 중 직접 대화가 계속 필요하면 executionMode를 interactive로 설정하세요. 이미 Decal Worker인 세션에서는 중첩 worker를 만들지 마세요. 먼저 DECAL_SESSION_ID의 존재 여부로 host를 판정하세요. 현재 turn이 Slice/Task 추천 카드에서 시작됐고 그 번호가 명시되어 있으면 같은 양의 정수를 sliceId로 포함하고, 일반 작업 공간이면 sliceId를 만들거나 추측하지 마세요. Decal 소유 세션에서는 goal, reason, completionCriteria, scope, exclusions, executionMode, workerRole과 해당할 때만 sliceId, 사용자가 명시한 경우에만 workerModelHint, workerResponseMode를 담아 decal_ui.propose_task_space 도구를 정확히 한 번 호출하세요. worker 모드에서는 부모 세션 선택을 유지하고, 워커가 계획·단계 진행·판단 필요·완료 준비를 부모에게 AI 메신저로 보고한 뒤 대기하며 report_task_space_return·병합·삭제·종료를 스스로 실행하지 않는다는 전제를 지키세요. interactive 모드의 복귀 보고와 병합 결과만 각각 decal_ui.report_task_space_return 또는 decal_ui.report_task_space_merge_result 도구로 만드세요. 외부 Codex/CLI host에서는 decal_ui를 호출하거나 Decal Worker·복귀 패널을 만든 것처럼 보고하지 말고, 같은 goal·reason·completionCriteria·scope·exclusions를 일반 텍스트와 portable handoff로 관리하세요. 사용자가 실제 분리 작업 공간 생성을 명시적으로 요청하면 branch/worktree·base·dirty 범위·정확한 대상·명령·보존할 변경을 확인하고 외부 host 규약의 승인 범위에서 생성할 수 있습니다. 작업 공간 상태 변경 직전에는 같은 전제를 다시 확인하고, Decal 소유 세션은 decal_ui.request_confirmation을, 외부 host는 같은 의미의 일반 텍스트 승인을 사용하세요. main 병합은 source branch·HEAD·merge base와 예상 merge write-set을 기록하고, main에 staged 변경이나 진행 중 Git 작업이 없으며 예상 충돌이 없고 main dirty 경로와 write-set이 겹치지 않을 때 대상 밖 dirty 변경을 보존한 채 허용하세요. 확인 당시 main HEAD는 재검증 기준점일 뿐 승인 대상을 그 SHA로 고정하지 마세요. 승인은 source branch·HEAD와 병합 동작을 고정하고, main만 전진하면 안전 조건을 다시 계산해 유지되는 경우 기존 승인을 사용하세요. 승인 뒤 main/source HEAD·dirty 경로·예상 merge 결과가 이 조건을 깨는 경우에만 새 상태로 확인받으세요. dirty main 병합 뒤 최종 Slice 상태·버전 정산도 저장소 전체 clean 여부가 아니라 격리·HEAD 결속·settlement lock gate를 별도로 통과시키세요. Decal 소유 세션에서 도구가 없거나 등록이 거절되면 외부 fallback으로 가장하지 말고 host recovery를 따르세요. 외부 host라는 이유만으로 portable 분리·복귀·병합 작업을 거절하지 마세요. 승인 뒤에도 해당 승인 범위 밖의 merge, rebase, push, 정리, 삭제는 새 확인 없이는 실행하지 마세요.
---

# 안전 작업 공간

Decal 소유 세션의 작업 공간 제안·복귀·병합 보고와 상태 변경 확인은 Decal 상호작용 패널로 만듭니다. 외부 Codex/CLI host는 같은 필드와 안전 gate를 일반 텍스트·portable handoff·직접 Git 절차로 관리하며 Native 패널을 가장하지 않습니다.

사용자에게 보이는 상태 변경 승인문은 `하려는 일`, `확인할 내용`, `영향`, `성공하면`, `확인`으로 정리하고 원시 명령과 예상 시간은 노출하지 않습니다. 병합·복귀 결과는 `처리 결과`, `결과 및 후속`으로 짧게 정리하며 변경 기록 해시는 사용자가 요청할 때만 표시합니다.
