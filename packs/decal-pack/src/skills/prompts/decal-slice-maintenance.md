---
id: decal-slice-maintenance
label: 데칼 Slice 유지보수 정산
version: 0.7.0
risk: host_policy_authorized
group: 작업
target: active-cli
prompt_visibility: hidden
template: 새 Task/Slice 등록, lifecycle 상태 전이, 승인된 Smoke의 test-pass 기록, 최종 완료·버전 정산, 결정적 index 재생성에만 사용하세요. 먼저 DECAL_SESSION_ID 존재 여부로 host를 판정하세요. Decal 소유 세션에서는 request_slice_maintenance_commit의 operation enum에 slice_register_intent, slice_transition_status, slice_record_test_pass, slice_complete_and_settle_version 네 semantic-intent-v1 operation이 모두 광고되는지 확인하세요. 하나라도 없으면 구형 세션이므로 operation auto나 prepared files로 축소하지 말고 세션·개발빌드를 갱신한 뒤 새 사용자 입력을 기다리세요. Host-owned intent에서는 공용 index/category, 번호가 붙은 문서와 version file을 선편집하지 마세요. 신규 등록은 안정된 intentId와 category·slug·title·priority·areas·summary·body·version/Remote impact만 operation slice_register_intent로 decal_ui.request_slice_maintenance_commit에 한 번 제출하세요. 일반 상태 전환은 slice_transition_status, 승인된 Smoke 정산은 slice_record_test_pass, 직접 완료·버전 정산은 slice_complete_and_settle_version을 사용하고, intentId·recordId·expectedSourceStatus와 operation별 target·blocked/postponed·Smoke 사실만 제출하세요. path·적용 버전·검증 HEAD·write-set은 보내지 않으며 Native가 latest main과 settlement lock 안에서 계산·검증·커밋합니다. operation auto와 exact paths는 결정적 index 재생성에만 사용하세요. 호출은 권한이 아니며 Decal native가 main, staged 상태, 실제 write-set과 문서 구조를 다시 검증합니다. policy_authorized면 `처리 결과`, `결과 및 후속`으로 짧게 보고하고 할당된 Task 번호는 표시하되 커밋 해시는 사용자가 요청할 때만 표시하세요. 거절·차단·no_change에서는 host recovery의 phase, cause, retryability, requestState, nextAction을 따르세요. correct_and_retry_same_turn은 requestState가 not_created이고 보고된 입력만 교정할 수 있을 때 정확히 한 번 허용합니다. prepared_write_retired 또는 refresh_session_then_retry는 같은 turn에서 operation auto로 재시도하지 않습니다. 그 밖에는 같은 turn에서 재시도하지 말고 변경을 보존한 채 원인과 해결 조건을 보고한 뒤 사용자 입력을 기다리세요. Decal 소유 세션에서는 직접 git add·git commit, 일반 커밋 도구, raw tag로 우회하지 마세요. 외부 Codex/CLI host에서는 이 도구를 가장하거나 호출하지 않고, 사용자의 현재 turn 실제 등록·상태·Smoke·완료 관리 요청을 canonical 파일 준비 승인으로 봅니다. 새 등록은 latest main과 registry/category에서 다음 미사용 번호·카테고리 순번·최종 경로를 재검증해 Task 문서·index·category index의 정확한 3경로만 작성하고, lifecycle은 공식 task:* 또는 legacy slice:* 명령으로 준비하세요. 즉시 identity·index·version 회귀를 실행하고 대상 밖 dirty를 보존하세요. 등록과 일반 상태 전환의 준비 권한은 커밋 권한이 아닙니다. 다만 사용자가 현재 turn에서 완료·정산을 명시 요청했고 그 작업이 `.decal/settlement-pending-v1.json`에 exact write-set을 발급하면, 같은 승인은 그 write-set의 즉시 격리 커밋과 `npm run settlement:finalize`까지 포함합니다. 다른 편집을 끼우지 말고 연속 수행하며, 커밋 또는 finalize가 차단되면 marker를 보존하고 `정산 준비 완료 · 커밋 대기`로 보고하세요. 구현 파일·다른 저장소·push·merge·deploy는 포함하지 않습니다. 외부 host라는 이유만으로 유지보수를 거절하지 마세요. 일반 소스·테스트·설정·임의 문서 변경과 merge, rebase, push, reset, stash, worktree 생성·삭제는 포함하지 마세요. Task·Work·Bug v2에서는 docs/tasks/index.md가 있으면 docs/tasks/index.md·docs/tasks/category_index.md·task_* 문서와 npm run task:*만 정본으로 사용하고, docs/slices·slice:*는 docs/tasks/index.md가 없는 legacy 프로젝트에만 적용하세요. 두 registry가 동시에 있으면 쓰기를 중단하고 충돌로 보고하세요.
---

# Slice 유지보수 정산

허용된 Slice 문서 유지보수만 native의 정확한 write-set 검증 뒤 커밋합니다.

## operation 판정

- 새 Slice 등록은 `slice_register_intent`를 사용하고 번호·카테고리 순번·path를 보내지 않습니다.
- 일반 상태 전환은 `slice_transition_status`, 승인된 Smoke 정산은 `slice_record_test_pass`, 직접 완료·버전 정산은 `slice_complete_and_settle_version` intent를 사용합니다.
- lifecycle intent는 `intentId`, `recordId`, `expectedSourceStatus`와 operation별 의미 사실만 보내며 문서·index·version을 선편집하거나 path·적용 버전·검증 HEAD를 보내지 않습니다.
- `auto`와 이미 준비·검증한 exact paths는 결정적 index 재생성에만 사용합니다.
- 등록·상태·Smoke·완료에서 semantic intent가 없으면 `prepared_write_retired`로 중단하며, 같은 turn에서 `auto`로 축소하지 않습니다.
- 외부 Codex/CLI host의 승인형 fallback은 Native 도구를 가장하지 않고 공식 `task:*` 또는 legacy `slice:*`와 정확한 대상 격리 규약을 따릅니다.
- 외부 host의 실제 등록 요청은 canonical 3경로 준비만 허용하며 커밋은 별도 사용자 승인을 요구합니다. 완료·정산의 명시 요청은 그 작업이 발급한 exact settlement write-set의 즉시 격리 커밋과 `npm run settlement:finalize`까지 같은 승인으로 연속 수행합니다.
- 명시 operation과 실제 변화가 불일치하면 native가 기대 operation과 source/target 상태를 진단합니다.

일반 개발 변경과 저장소 병합·원격 작업은 이 스킬의 권한이 아닙니다.

## 오류 처리

- `correct_and_retry_same_turn` + `not_created`: 보고된 입력만 고쳐 정확히 한 번 재호출합니다.
- `retry_after_user_input`: 변경을 보존하고 원인·해결 조건을 보고한 뒤 새 사용자 입력을 기다립니다.
- `repair_state_then_retry`: branch·staged·write-set·문서 상태를 읽기 전용으로 확인하고 안전하게 해결된 뒤 새 입력에서 재호출합니다.
- `refresh_session_then_retry`: 새 turn·세션·앱 적용 조건을 설명하고 현재 turn에서는 반복하지 않습니다.
- `do_not_retry`: 저장소 변경을 멈추고 진단 코드를 보고합니다.

Decal 소유 세션은 어떤 오류 분류에서도 직접 커밋, 일반 커밋 도구, raw tag로 우회하지 않습니다. 외부 host는 Native 오류 복구를 가장하지 않고 프로젝트의 수기/CLI fallback을 사용합니다.

## 사용자 결과 알림

- **처리 결과**: 수행한 등록·상태 전환·정산과 필수 점검 결과
- **결과 및 후속**: 다음 상태, 남은 앱 적용·검증·정리

커밋 해시와 내부 영수증 필드는 사용자가 요청할 때만 표시합니다.
