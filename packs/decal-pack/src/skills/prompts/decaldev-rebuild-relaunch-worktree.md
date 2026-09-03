---
id: decaldev-rebuild-relaunch-worktree
label: 데칼 A/B 워킹트리 테스트 빌드
version: 0.2.0
risk: confirmation_required
group: 개발
target: active-cli
prompt_visibility: hidden
accepts_additional_input: false
template: 현재 세션의 Git 최상위 경로를 Launcher Hub의 데칼 테스트 대상으로 지정하고, 연결된 작업 공간(worktree) 소스로 A/B 중 안전하게 배정된 별도 macOS 디버그 앱을 빌드·재시작합니다. 먼저 macOS인지, 현재 Git 최상위 경로·브랜치·변경 기록 위치·미기록 상태, 등록된 데칼 main과 같은 저장소인지, 필요한 보조 도구와 개발 프로필이 있는지 읽기 전용으로 확인하세요. main 루트 자체이거나 linked worktree가 아니면 실행하지 마세요. 현재 작업을 소유하는 canonical Task·Work·Bug 정본이 하나로 확인되면 그 ID를 사용하고 브랜치 이름만으로 번호를 추측하지 마세요. 정본이 명확하지 않으면 번호 없는 A/B fallback을 사용하세요. 선택 helper가 돌려준 슬롯과 같은 슬롯을 build-open에 사용하세요. 같은 worktree·record는 기존 슬롯을 재사용하고 빈 슬롯은 A 다음 B로 자동 배정합니다. A/B가 모두 사용 중이면 어떤 슬롯도 탈취·종료하지 말고 현재 소유 대상을 설명한 뒤 교체할 슬롯을 별도 승인받으세요. 선택·빌드 명령과 실제 경로는 내부 실행 계획으로만 유지하세요. 실행 직전 사용자 안내는 `하려는 일`, `확인할 내용`, `영향`, `성공하면`, `확인`으로 쓰고 원시 명령·변경 기록 해시·예상 시간은 노출하지 마세요. 먼저 DECAL_SESSION_ID의 존재 여부로 host를 판정하세요. Decal 소유 세션에서는 decal_ui.request_confirmation 도구를 정확히 한 번 호출하고 등록 뒤 사용자 결정을 기다리며, 도구가 없거나 등록이 거절되면 외부 fallback으로 가장하지 말고 host recovery를 따르세요. 외부 Codex/CLI host에서는 decal_ui를 호출하거나 패널·태그 문자열을 출력하지 말고 같은 내용을 일반 텍스트로 승인받으세요. 버전 증가, 자동 정산 커밋, 기록 대기 변경 조작, 되돌리기, 병합, 원격 전송, 호스팅된 리모트 미리보기 배포를 하지 않고 성공 뒤에만 해당 슬롯의 기존 테스트 앱 PID를 교체한다는 영향을 쉬운 말로 설명하세요. 승인 뒤에만 선택과 빌드를 순서대로 실행하고 전제가 달라지면 다시 확인받으세요. 외부 host라는 이유만으로 유효한 linked worktree 테스트 빌드를 거절하지 마세요. 테스트가 끝나면 해당 슬롯만 `테스트 종료·슬롯 반납`으로 정리하고 worktree·브랜치·미기록 변경·build cache는 보존하세요. 결과는 `처리 결과`, `결과 및 후속`으로 프로젝트·작업 공간 이름·브랜치, 배정 슬롯, `Decal TestBuild - <작업번호>` 표시명, 빌드·실행·반납 여부만 요약하고 변경 기록 해시·내부 세션 식별자·토큰·인증 정보·프로필 원문은 출력하지 마세요.
---

# 데칼 A/B 워킹트리 테스트 빌드

macOS의 유효한 Decal linked worktree를 Launcher Hub의 고정 A/B 슬롯 중 하나에 지정하고 `Decal TestBuild - <Task·Work·Bug 번호>` 디버그 앱을 여는 개발 전용 스킬입니다.

이 경로는 `main-latest`와 분리됩니다. Desktop/Remote 버전 파일, Git stage·commit, hosted Remote Preview를 변경하지 않으며 빌드 실패 시 해당 슬롯의 기존 테스트 앱을 유지합니다. A/B는 bundle identifier·로그인 callback·refresh credential service까지 분리됩니다.

Decal 소유 세션은 `decal_ui.request_confirmation`을 사용하고, 외부 Codex/CLI host는 같은 대상·영향을 일반 텍스트로 승인받은 뒤 동일한 재검증 규칙으로 실행합니다.

내부 실행 순서는 canonical record를 포함한 `select`, 반환된 A/B 슬롯으로 `build-open --project agent-studio --slot <반환 슬롯>`, 테스트 종료 뒤 같은 슬롯의 `release`를 사용하는 Launcher Hub 보조 명령입니다. 이 원시 명령은 사용자 승인문에 노출하지 않습니다.
