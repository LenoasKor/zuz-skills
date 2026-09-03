---
id: decal-slice-smoke
label: 데칼 슬라이스 자동 Smoke
version: 0.5.0
risk: confirmation_required
group: 작업
target: active-cli
prompt_visibility: hidden
template: docs/slices/index.md와 개별 문서에서 development_complete와 release_ready Slice를 선별하세요. postponed는 Smoke·검증·현재 출시 후보에서 항상 제외하고 사용자가 재검토를 명시해 planned로 재개한 뒤에만 다시 판단하세요. 앱 snapshot의 `assignment.taskSpaceLinked`가 true인 Smoke 후보를 먼저 고르고, 필드가 없거나 false이면 기존 순서를 유지하세요. 첫 응답에서는 읽기만 하고 AI가 자체 실행 가능한 후보를 `하려는 일`, `확인할 내용`, `영향`, `성공하면`, `확인`으로 보고하세요. 사용자에게 원시 명령이나 예상 시간을 노출하지 말고, `확인할 내용`마다 어떤 Task의 어떤 동작을 확인하는지 적으세요. GUI·실기기·계정·비밀값·외부 서비스·배포가 필요한 항목은 자동 가능으로 분류하지 마세요. 실행 직전에 후보 상태·실제 명령·변경 범위와 DECAL_SESSION_ID 존재 여부를 다시 확인하세요. Decal 소유 세션은 decal_ui.request_confirmation을 정확히 한 번 호출해 실제 Slice 번호·명령·영향·성공 시 전이를 요청하고, 도구가 없거나 등록이 거절되면 외부 fallback으로 가장하지 말고 host recovery를 따르세요. 외부 Codex/CLI host는 decal_ui를 호출하거나 패널을 가장하지 않고 같은 내용을 일반 텍스트로 승인받으세요. 승인 뒤에는 승인된 후보와 명령만 실행하세요. 자동 Smoke가 통과하면 Decal 소유 세션은 Task/Slice 문서·index·version file을 선편집하거나 npm run task:test-pass/slice:test-pass를 실행하지 말고, 안정된 intentId, recordId, expectedSourceStatus, targetStatus, confirmedAt, confirmedBy ai, environment, summary만 operation slice_record_test_pass로 decal_ui.request_slice_maintenance_commit에 한 번 제출하세요. 앱 적용만 남으면 targetStatus를 release_ready로, 아니면 completed로 둡니다. Native가 latest main에서 완료 기준·검증 HEAD·적용 버전·정확한 write-set을 계산합니다. 외부 Codex/CLI host는 같은 승인된 Smoke 사실로 공식 npm run task:test-pass 또는 legacy slice:test-pass를 실행해 canonical 상태·영수증·version을 준비하고 identity·index·version 회귀를 확인하세요. 사용자가 승인한 Smoke의 성공 조건에 완료·정산이 포함되어 있고 명령이 `.decal/settlement-pending-v1.json`에 exact write-set을 발급하면, 그 승인은 해당 정산 write-set의 즉시 격리 커밋과 `npm run settlement:finalize`까지 포함합니다. 커밋 또는 finalize가 차단되면 marker를 보존하고 `정산 준비 완료 · 커밋 대기`로 보고하며 완료로 표현하지 마세요. 등록·일반 전이·구현 파일·다른 저장소·push·merge·배포는 별도 권한입니다. 외부 host라는 이유만으로 Smoke나 정산 준비를 거절하지 마세요. Task·Work·Bug v2에서는 docs/tasks/index.md가 있으면 docs/tasks/index.md·docs/tasks/category_index.md·task_* 문서와 npm run task:*만 정본으로 사용하고, docs/slices·slice:*는 docs/tasks/index.md가 없는 legacy 프로젝트에만 적용하세요. 두 registry가 동시에 있으면 쓰기를 중단하고 충돌로 보고하세요.
---

# 슬라이스 자동 Smoke

후보 보고와 사용자 승인 뒤 실행을 분리합니다. 상호작용 확인은 `decal_ui.request_confirmation`으로만 열고, 도구를 쓸 수 없으면 일반 텍스트 질문으로 안전하게 멈춥니다.

사용자 승인문에는 원시 명령과 예상 시간을 넣지 않고, 확인 대상과 영향을 쉬운 말로 설명합니다.
