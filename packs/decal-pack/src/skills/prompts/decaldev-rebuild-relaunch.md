---
id: decaldev-rebuild-relaunch
label: 데칼 개발빌드 재시작
version: 0.12.0
risk: confirmation_required
group: 개발
target: active-cli
prompt_visibility: hidden
accepts_additional_input: false
template: 이 스킬은 main 작업공간의 개발 앱 전용이며 linked worktree 테스트나 정식 배포 요청에는 사용하지 마세요. 프로젝트의 출시 전·운영 중 여부는 일반 개발빌드 조건이 아니므로 묻거나 추정하지 마세요. 쇼케이스는 선택입니다. 사용자가 쇼케이스 사용을 요청했거나 프로젝트의 `config/decal-build.json`에 `"showcase": true`가 있을 때만 그 등록 결과가 현재 프로젝트·소스 revision과 정확한 개발 앱 대상을 가리키는지 확인하고, 그 밖에는 쇼케이스 없이 진행합니다. 이 프로젝트 데칼의 현재 운영체제용 디버그 앱과 닫힌 데칼 리모트 미리보기만 최신 소스로 적용하고 재시작합니다. 출시 빌드, 중계 서버, 비밀값, 운영 도메인은 절대 변경하지 마세요. 먼저 운영체제, 소스 변경 여부, 정확한 디버그 앱·미리보기 대상과 빌드·재시작 범위를 읽기 전용으로 확인하세요. macOS와 Windows의 프로젝트 표준 실행 명령은 내부 실행 계획으로만 유지하고 그 밖의 운영체제에서는 실행하지 마세요. 실행 직전 사용자 안내는 `하려는 일`, `확인할 내용`, `영향`, `성공하면`, `확인`으로 쓰고 원시 명령과 예상 시간은 노출하지 마세요. 먼저 DECAL_SESSION_ID의 존재 여부로 host를 판정하세요. Decal 소유 세션에서는 같은 요청·앱·종료 영향·preview 범위의 유효한 Host 승인이 없을 때 decal_ui.request_confirmation 도구를 한 번 호출하고 결정을 기다리며, 도구가 없거나 등록이 거절되면 외부 fallback으로 가장하지 말고 host recovery를 따르세요. 외부 Codex/CLI host에서는 decal_ui를 호출하거나 패널·태그 문자열을 출력하지 말고 같은 범위의 유효한 사용자 승인이 없을 때만 일반 텍스트로 승인받으세요. 실제 재빌드는 제품 SemVer를 바꾸거나 버전 파일을 커밋하지 않고 Desktop·Remote artifact에 고유 Build ID를 발급합니다. Remote 정적 preview 적용이 실패하면 경고와 미적용 사실을 보고하되 macOS 로컬 앱 재시작은 계속합니다. 승인 뒤에만 내부 명령을 실행하고 대상 앱·종료 영향·외부 preview·비용·권한이 실질적으로 바뀔 때만 다시 확인받으세요. SHA 변경만으로 재질문하지 않으며 검증된 main 커밋 전진은 허용하되 다른 작업의 미커밋 소스는 혼입하지 마세요. 외부 host라는 이유만으로 표준 개발빌드 재시작을 거절하지 마세요. 결과는 `처리 결과`, `결과 및 후속`으로 앱 PID, Desktop·Remote 제품 버전과 Build ID, 미리보기 점검을 요약하고 커밋 해시는 사용자가 요청할 때만 표시하세요.
---

# 데칼 개발빌드 재시작

macOS와 Windows 디버그 빌드 전용 스킬입니다. Decal 소유 세션은 `decal_ui.request_confirmation`을 사용하고, 외부 Codex/CLI host는 같은 범위를 일반 텍스트로 승인받습니다.

프로젝트 출시 단계는 Showcase 빌드 등록·테스트 흐름이 자체 경계에서 확인하며 이 개발빌드의 입력이나 중단 조건이 아닙니다.

출시 단계 판정이 필요한 연계 흐름에서 저장값이 누락·null·`unset`이면 묻거나 중단하지 않고 `pre_live`로 해석합니다. 이 폴백은 저장값을 바꾸거나 배포·정산 권한을 열지 않으며, 명시 저장된 `live`는 그대로 유지합니다.

쇼케이스는 필수가 아닙니다. 사용자가 요청했거나 프로젝트의 `config/decal-build.json`에 `"showcase": true`가 있으면 쇼케이스 개발빌드 등록 결과와 일치하는 대상에, 그 밖에는 곧바로 아래 표준 경로를 사용합니다. 쇼케이스를 쓰기로 했는데 등록이 실패하거나 대상이 다르면 그 빌드·재시작만 보류하고 원인과 다음 행동을 보고합니다.

쇼케이스 사용 여부는 저장소에 커밋된 `config/decal-build.json`(`{"schema": "decal.build-tools/v1", "showcase": true}`)으로 정합니다. 파일이 없거나 `showcase`가 `true`가 아니면 쇼케이스를 쓰지 않는 프로젝트입니다. 사용자가 이번 요청에서 쇼케이스를 쓰라고 하면 파일과 관계없이 그 요청을 따릅니다.

- macOS: `scripts/open_latest_macos.sh`
- Windows: `scripts/open_latest_windows.ps1`

두 경로 모두 release 빌드·Relay·프로덕션 배포를 제외하고, 현재 소스와 일치하는 debug 앱만 대상으로 독립 helper를 준비한 뒤 실행 중인 정확한 앱·registry 소유 runtime만 재시작합니다. helper 준비 또는 앱 빌드 실패 시 기존 앱을 보존합니다. macOS Remote 정적 preview 적용 실패는 경고로 남기고 로컬 앱 재시작은 계속합니다.

닫힌 Decal Remote Workers Static Assets preview만 현재 번들로 확인·적용하며, 실패하면 Remote 미적용을 명시합니다. `decal-relay`와 프로덕션 배포는 이 스킬 범위에 포함하지 않습니다.

Tauri build hook과 Remote 정적 preview는 제품 SemVer를 바꾸지 않습니다. 한 build run에서 Desktop과 Remote가 연관된 고유 Build ID를 받고, Remote cache·배포 확인은 제품 버전 대신 그 Build ID를 사용합니다.

실제 재빌드 전후 Desktop 5개·Remote 1개 제품 버전 파일은 byte 불변이어야 합니다. legacy hook이 파일을 바꾸면 빌드 경로가 원문을 복구하고 실패합니다. Build ID counter와 artifact metadata는 Git 추적 파일 밖에 두며 빌드·재시작 자체는 stage·commit을 만들지 않습니다.

## 승인 재사용 경계

같은 요청·앱·종료 영향·닫힌 preview·비용·권한 범위의 승인은 같은 수정/검증 루프에 재사용한다. 실행 직전 소스·artifact·프로세스 소유권을 재검증한다. 정상 main 커밋 전진만으로 재질문하지 않는다. 다른 작업의 미커밋 혼입은 준비 문제이며 임의 삭제하거나 타 세션을 종료하지 않는다. Native는 지원된 grant 재사용 기능만 사용하고 문구만으로 새 grant를 만들지 않는다. 기능 부재는 해당 재시작만 보류한다.
