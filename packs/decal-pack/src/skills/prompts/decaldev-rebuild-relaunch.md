---
id: decaldev-rebuild-relaunch
label: 데칼 개발빌드 재시작
version: 0.9.0
risk: confirmation_required
group: 개발
target: active-cli
prompt_visibility: hidden
accepts_additional_input: false
template: Decal 실행 컨텍스트의 프로젝트 출시 단계를 먼저 확인하세요. unset이면 단계 선택을 요청하고 빌드하지 마세요. 이 스킬은 main 작업공간의 development lane 전용이며 linked worktree나 release_candidate·official_release 요청에는 사용하지 마세요. 빌드 전에 프로젝트 단계·검증 목적·작업공간 종류(main)·선택한 빌드 종류(development)를 사용자에게 표시하세요. 이 프로젝트 데칼의 현재 운영체제용 디버그 앱과 닫힌 데칼 리모트 미리보기만 최신 소스로 적용하고 재시작합니다. 출시 빌드, 중계 서버, 비밀값, 운영 도메인은 절대 변경하지 마세요. 먼저 운영체제, 소스 변경 여부, 정확한 디버그 앱·미리보기 대상과 빌드·재시작 범위를 읽기 전용으로 확인하세요. macOS와 Windows의 프로젝트 표준 실행 명령은 내부 실행 계획으로만 유지하고 그 밖의 운영체제에서는 실행하지 마세요. 실행 직전 사용자 안내는 `하려는 일`, `확인할 내용`, `영향`, `성공하면`, `확인`으로 쓰고 원시 명령과 예상 시간은 노출하지 마세요. 먼저 DECAL_SESSION_ID의 존재 여부로 host를 판정하세요. Decal 소유 세션에서는 decal_ui.request_confirmation 도구를 정확히 한 번 호출하고 등록 뒤 사용자 결정을 기다리며, 도구가 없거나 등록이 거절되면 외부 fallback으로 가장하지 말고 host recovery를 따르세요. 외부 Codex/CLI host에서는 decal_ui를 호출하거나 패널·태그 문자열을 출력하지 말고 같은 내용을 일반 텍스트로 승인받으세요. 실제 재빌드는 제품 SemVer를 바꾸거나 버전 파일을 커밋하지 않고 Desktop·Remote artifact에 고유 Build ID를 발급합니다. 승인 뒤에만 내부 명령을 실행하고 소스·미리보기 범위가 달라지면 다시 확인받으세요. 외부 host라는 이유만으로 표준 개발빌드 재시작을 거절하지 마세요. 결과는 `처리 결과`, `결과 및 후속`으로 앱 PID, Desktop·Remote 제품 버전과 Build ID, 미리보기 점검을 요약하고 커밋 해시는 사용자가 요청할 때만 표시하세요.
---

# 데칼 개발빌드 재시작

macOS와 Windows 디버그 빌드 전용 스킬입니다. Decal 소유 세션은 `decal_ui.request_confirmation`을 사용하고, 외부 Codex/CLI host는 같은 범위를 일반 텍스트로 승인받습니다.

프로젝트가 `출시 전`이든 `운영 중`이든 일반 구현·기능 확인은 이 development lane을 사용합니다. 단계가 미설정이면 빌드 전에 반드시 선택받고, 성능이나 production 관습을 이유로 릴리즈 후보로 바꾸지 않습니다.

- macOS: `scripts/open_latest_macos.sh`
- Windows: `scripts/open_latest_windows.ps1`

두 경로 모두 release 빌드·Relay·프로덕션 배포를 제외하고, 현재 소스와 일치하는 debug 앱만 대상으로 독립 helper를 준비한 뒤 실행 중인 정확한 앱·registry 소유 runtime만 재시작합니다. helper 준비 또는 빌드·preview 확인 실패 시 기존 앱을 보존합니다.

닫힌 Decal Remote Workers Static Assets preview만 현재 번들로 확인·적용하며, `decal-relay`와 프로덕션 배포는 이 스킬 범위에 포함하지 않습니다.

Tauri build hook과 Remote 정적 preview는 제품 SemVer를 바꾸지 않습니다. 한 build run에서 Desktop과 Remote가 연관된 고유 Build ID를 받고, Remote cache·배포 확인은 제품 버전 대신 그 Build ID를 사용합니다.

실제 재빌드 전후 Desktop 5개·Remote 1개 제품 버전 파일은 byte 불변이어야 합니다. legacy hook이 파일을 바꾸면 빌드 경로가 원문을 복구하고 실패합니다. Build ID counter와 artifact metadata는 Git 추적 파일 밖에 두며 빌드·재시작 자체는 stage·commit을 만들지 않습니다.
