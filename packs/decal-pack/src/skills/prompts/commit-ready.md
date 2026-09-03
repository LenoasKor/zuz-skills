---
id: decal-commit-ready
label: 데칼 커밋
version: 0.9.0
risk: confirmation_required
group: 저장소
target: active-cli
template: 현재 브랜치와 작업 공간(worktree), 변경 기록 위치(HEAD), 진행 중 Git 작업, 기록 대기·미기록 변경과 정확한 커밋 대상 경로를 읽기 전용으로 확인하세요. 권한 모드를 판단하지 마세요. canonical Task·Work·Bug의 구현, 완료 기준 checkbox, 필수 자동 검증이 모두 끝났고 active AgentTaskLease와 exact write-set이 있으며 decal_ui.commit_completed_work가 있으면 recordKind·recordId·paths·verification으로 그 도구를 별도 사용자 질문 없이 정확히 한 번 호출하세요. policy_authorized면 Native 대상 격리 커밋이 끝난 상태이고, typed rejection이면 변경을 보존한 채 차단 원인과 다음 행동을 보고하세요. 이 checkpoint는 push·merge·deploy·lifecycle 완료·Smoke·버전 정산 권한이 아닙니다. 자동 checkpoint 조건을 충족하지 않으면 사용자 승인문을 `하려는 일`, `확인할 내용`, `영향`, `성공하면`, `기록할 내용`, `확인` 순서로 쓰고, `기록할 내용`에는 주요 파일의 짧은 링크와 보존할 무관 변경만 적으세요. 사용자에게 별도 포함 파일 목록이나 변경 기록 이름을 노출하지 마세요. 내부 커밋 메시지와 정확한 경로는 decal_ui.request_commit의 message·paths에만 넣고 도구를 정확히 한 번 호출하세요. 도구가 없고 현재 개발자 안내(developer notice)에 데칼 커밋 호환 권한(commit compatibility capability)이 명시된 복원 응답이면, 같은 필드에 version 1과 해당 권한을 더한 정확히 하나의 raw <decal_commit_request>{JSON}</decal_commit_request>를 응답 끝에 출력하고 종료하세요. 둘 다 없으면 DECAL_SESSION_ID의 값이 아니라 존재 여부만 확인하세요. 값이 있으면 고장 난 데칼 소유 세션(계약 표현: 고장 난 Decal 소유 세션)이므로 직접 기록하거나 일반 확인으로 우회하지 말고 중단하세요. 값이 없으면 외부 명령줄 AI 환경(외부 Codex/CLI host)입니다. 외부 환경에서는 사용자가 현재 응답(현재 turn)에서 정확한 범위의 커밋을 명시 요청했거나 canonical Task·Work·Bug의 완료·정산을 명시 요청했고 그 작업이 `.decal/settlement-pending-v1.json`에 exact settlement write-set을 발급한 경우에만 승인으로 사용하세요. 후자의 승인은 그 정산 write-set의 즉시 격리 커밋과 `npm run settlement:finalize`까지만 포함하며 구현 파일·다른 저장소·push·merge·deploy는 포함하지 않습니다. 어느 조건도 없으면 같은 사용자 승인 형식으로 제안한 뒤 답을 기다리세요. 승인 뒤 실행 직전에 동일한 브랜치·작업 공간, 변경 기록 위치의 안전한 연속성, 진행 중 Git 작업, 기록 대기 범위, 대상 내용·존재 여부를 다시 확인하세요. 전제가 유지될 때만 구체 파일을 정확히 기록하고 git commit --only -- <paths>로 대상 격리 커밋하세요. 경로는 저장소 루트 기준의 구체 파일만 쓰고 디렉터리·통합 패턴을 쓰지 마세요. 대상 밖 변경은 보존하세요. 정산 커밋이면 다른 편집 전에 즉시 `npm run settlement:finalize`를 실행하세요. 커밋 또는 finalize가 차단되면 pending marker를 보존하고 `정산 준비 완료 · 커밋 대기`로 보고하며 내구성 있는 정산 완료로 표현하지 마세요. 전제가 달라지면 멈추고 새 상태로 다시 승인받으세요. 데칼 소유 세션에서는 상태 저장·재검증·커밋을 Decal Native만 소유하며 외부 대체 경로를 사용하지 않습니다. 일반 확인 패널, 임의 명령, 작업 공간, 원격 전송·이력 재배치·되돌리기로 대체하지 마세요. 일반 commit 요청 결과가 registered면 답변을 끝내고 사용자 결정을 기다리세요. policy_authorized면 커밋이 이미 끝난 상태입니다. 이때와 외부 커밋 완료 때는 `처리 결과`, `기타`로 요약하고 커밋 해시는 사용자가 요청할 때만 표시하세요. 세부 테스트 이름은 `필수 점검 통과`로 줄이고, 무관 변경 보존·작업 공간 상태·미수행 상태·버전 정산·정리는 `기타`에 적으세요. 무효·차단 통보를 받으면 같은 대상을 다시 발행하거나 기록하지 말고 중단해 사용자 지시를 기다리세요. 원격 전송은 별도 확인 없이는 하지 마세요.
---

# Decal Commit

데칼 소유 세션은 canonical 단위 작업과 검증이 끝나고 active AgentTaskLease·exact write-set이 있으면 우선 `decal_ui.commit_completed_work`를 한 번 호출합니다. 그 조건이 아니면 모든 지원 권한 모드에서 `decal_ui.request_commit`을 사용하고, 오래된 복원 Codex 대화는 현재 응답의 앱 발급 호환 권한만 사용합니다. 외부 명령줄 AI 환경에서는 두 신호와 `DECAL_SESSION_ID`가 모두 없음을 확인한 뒤, 현재 응답의 명시적 사용자 요청에 한정해 같은 정확한 경로 격리를 직접 수행합니다. 외부 환경이 데칼 패널을 흉내 내거나 고장 난 데칼 세션을 우회하지는 않습니다.

## 사용자 승인문

- **하려는 일**: 승인 범위만 변경 기록으로 확정
- **확인할 내용**: 대상 내용과 무관 변경 분리 상태
- **영향**: 승인한 변경만 저장소 이력에 추가
- **성공하면**: 변경 기록 생성
- **기록할 내용**: 주요 문서 링크와 보존할 무관 변경
- **확인**: 이 범위로 기록할지 질문

## 완료 알림

- **처리 결과**: 커밋·병합 완료, 필수 점검 통과
- **기타**: 무관 변경 보존, 작업 공간 상태, 미수행 정산·정리
