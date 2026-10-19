---
id: decaldev-rebuild-relaunch-worktree
label: 데칼 워크트리 테스트 빌드
version: 0.8.0
risk: confirmation_required
group: 개발
target: active-cli
prompt_visibility: hidden
accepts_additional_input: false
template: 개발 채널에서 Native 도구 `manage_showcase_test_build`가 실제 광고되면 현재 linked worktree를 소유하는 신뢰된 이 스킬의 호출과 현재 Task 권한으로만 진행하세요. list는 operation만, inspect는 operation과 candidateId만 전달하고 candidateRevision은 inspect에서 생략하세요. allocate에서만 candidateRevision/buildId/contractDigest를 함께 전달합니다. 검증된 terminal indeterminate가 nextOperation:null로 오면 같은 run을 보존하고 조회 반복을 멈추세요. list → inspect로 현재 작업본의 test 빌드를 확인한 뒤 allocate를 한 번 호출하고 nextOperation에 따라 bind·build·open을 진행하고 검수 뒤 stop·release를 진행하세요. remove는 요청 또는 이미 승인된 정리 범위에 포함된 경우에만 진행하세요. allocate의 slotOrdinal을 생략하면 쇼케이스가 빈 슬롯을 원자적으로 선택합니다. 사용자가 정확한 슬롯을 지정한 경우에만 slotOrdinal(1~8)을 전달하며 실패 시 다른 슬롯으로 바꾸지 마세요. pending 또는 결과 불명확은 같은 runId의 allocation-status 또는 status로만 조회하고 변경 요청을 재전송하지 마세요. 이 경로 전에 기존 handoff나 CLI 등록을 실행하지 마세요. Native 권한이 없거나 거절되면 다른 도구·파일로 가장하지 말고 해당 단계만 보류하세요. 이 스킬은 유효한 linked worktree의 격리 테스트 전용이며 main 작업공간이나 정식 배포 요청에는 사용하지 마세요. 프로젝트의 출시 전·운영 중 여부는 일반 워크트리 테스트빌드 조건이 아니므로 묻거나 추정하지 마세요. 격리 테스트 앱은 쇼케이스가 배정한 슬롯으로만 만들 수 있으므로, 사용자가 쇼케이스 테스트를 요청했거나 프로젝트의 `config/decal-build.json`에 `"showcase": true`가 있을 때만 이 스킬로 쇼케이스 개발빌드 등록 후 진행합니다. 그 밖에는 이 스킬을 쓰지 않고 worktree에서 자동 테스트로 검증한 뒤 병합 후 main 개발빌드 재시작으로 확인하도록 안내하세요. 현재 세션의 Git 최상위 경로와 연결된 작업 공간(worktree) 소스를 등록하고, 등록 결과로 확인된 별도 macOS 디버그 앱을 빌드·재시작합니다. 먼저 macOS인지, 현재 Git 최상위 경로·브랜치·변경 기록 위치·미기록 상태, 등록된 데칼 main과 같은 저장소인지, 쇼케이스 개발빌드 등록 경로와 테스트 앱 격리 설정이 있는지 읽기 전용으로 확인하세요. main 루트 자체이거나 linked worktree가 아니면 실행하지 마세요. 현재 작업을 소유하는 canonical zuz ITS 정본이 하나로 확인되면 그 ID를 사용하고 브랜치 이름만으로 번호를 추측하지 마세요. 정본이 명확하지 않으면 작업번호를 추정하지 마세요. 쇼케이스의 개발빌드 등록 결과에서 프로젝트·worktree·소스 revision과 빌드·실행 대상을 확인하고 같은 대상으로 진행하세요. 기존 테스트 앱의 bundle identifier·로그인 callback·credential 저장소 격리를 확인하세요. 다른 작업이 사용하는 대상을 탈취하거나 종료하지 말고 교체가 필요하면 해당 대상을 별도 승인받으세요. 등록·빌드의 실제 경로와 명령은 내부 실행 계획으로만 유지하세요. 실행 직전 사용자 안내는 `하려는 일`, `확인할 내용`, `영향`, `성공하면`, `확인`으로 쓰고 원시 명령·변경 기록 해시·예상 시간은 노출하지 마세요. 먼저 DECAL_SESSION_ID의 존재 여부로 host를 판정하세요. Decal 소유 세션에서는 같은 요청·앱·종료 영향·preview 범위의 유효한 Host 승인이 없을 때 decal_ui.request_confirmation 도구를 한 번 호출하고 결정을 기다리며, 도구가 없거나 등록이 거절되면 외부 fallback으로 가장하지 말고 host recovery를 따르세요. 외부 Codex/CLI host에서는 decal_ui를 호출하거나 패널·태그 문자열을 출력하지 말고 같은 범위의 유효한 사용자 승인이 없을 때만 일반 텍스트로 승인받으세요. 버전 증가, 자동 정산 커밋, 기록 대기 변경 조작, 되돌리기, 병합, 원격 전송, 호스팅된 리모트 미리보기 배포를 하지 않고 성공 뒤에만 등록된 해당 대상의 기존 테스트 앱 PID를 교체한다는 영향을 쉬운 말로 설명하세요. 승인 뒤에만 쇼케이스 개발빌드 등록과 빌드를 순서대로 실행하고 앱 대상·종료 영향·외부 공개·비용·권한이 달라질 때만 다시 확인받으세요. 외부 host라는 이유만으로 유효한 linked worktree 테스트 빌드를 거절하지 마세요. 테스트가 끝나면 이번에 등록·실행한 테스트 대상만 쇼케이스의 지원 절차로 테스트 종료 처리하고 worktree·브랜치·미기록 변경·build cache는 보존하세요. 결과는 `처리 결과`, `결과 및 후속`으로 프로젝트·작업 공간 이름·브랜치, 쇼케이스 개발빌드 등록 결과, `Decal TestBuild - <작업번호>` 표시명, 등록·빌드·실행·종료 여부만 요약하고 변경 기록 해시·내부 세션 식별자·토큰·인증 정보·프로필 원문은 출력하지 마세요.
---

# 데칼 워크트리 테스트 빌드

쇼케이스의 개발빌드 등록기능을 이용하여 macOS의 유효한 Decal linked worktree 개발빌드를 등록한 후 `Decal TestBuild - <zuz ITS 티켓 번호>` 디버그 앱을 여는 개발 전용 스킬입니다.

쇼케이스는 필수 프로그램이 아닙니다. 격리 테스트 앱은 쇼케이스가 배정한 슬롯으로만 빌드되므로, 이 스킬은 사용자가 쇼케이스 테스트를 요청했거나 프로젝트의 `config/decal-build.json`에 `"showcase": true`가 있을 때만 씁니다. 그 밖에는 worktree에서 자동 테스트로 검증하고, 병합 뒤 main 개발빌드 재시작으로 확인합니다.

쇼케이스 사용 여부는 저장소에 커밋된 `config/decal-build.json`(`{"schema": "decal.build-tools/v1", "showcase": true}`)으로 정합니다. 파일이 없거나 `showcase`가 `true`가 아니면 쇼케이스를 쓰지 않는 프로젝트입니다. 사용자가 이번 요청에서 쇼케이스를 쓰라고 하면 파일과 관계없이 그 요청을 따릅니다.

이 경로는 `main-latest`와 분리됩니다. Desktop/Remote 버전 파일, Git stage·commit, hosted Remote Preview를 변경하지 않으며 빌드 실패 시 등록된 해당 대상의 기존 테스트 앱을 유지합니다. 테스트 앱은 bundle identifier·로그인 callback·refresh credential service까지 일반 개발 앱과 분리되어야 합니다.

프로젝트 출시 단계는 Showcase 빌드 등록·테스트 흐름이 자체 경계에서 확인하며 이 워크트리 테스트빌드의 입력이나 중단 조건이 아닙니다.

출시 단계 판정이 필요한 연계 흐름에서 저장값이 누락·null·`unset`이면 묻거나 중단하지 않고 `pre_live`로 해석합니다. 이 폴백은 저장값을 바꾸거나 배포·정산 권한을 열지 않으며, 명시 저장된 `live`는 그대로 유지합니다.

Decal 소유 세션은 `decal_ui.request_confirmation`을 사용하고, 외부 Codex/CLI host는 같은 대상·영향을 일반 텍스트로 승인받은 뒤 동일한 재검증 규칙으로 실행합니다.

내부 실행 순서는 쇼케이스의 개발빌드 등록 → 등록 결과의 프로젝트·worktree·소스 revision·격리 대상 확인 → 해당 개발빌드 빌드·실행 → 검수 → 이번 테스트 대상 종료입니다. 실제 등록·실행 방법은 쇼케이스가 제공하는 기능과 확인된 계약을 사용하며 임의의 보조 명령을 추정하지 않습니다. 등록 실패나 대상 불일치 시 그 빌드·재시작만 보류하고 원인과 다음 행동을 보고합니다.

## 승인 재사용 경계

같은 요청·앱·종료 영향·닫힌 preview·비용·권한 범위의 승인은 같은 수정/검증 루프에 재사용한다. 실행 직전 소스·artifact·프로세스 소유권을 재검증한다. 정상 main 커밋 전진만으로 재질문하지 않는다. 다른 작업의 미커밋 혼입은 준비 문제이며 임의 삭제하거나 타 세션을 종료하지 않는다. Native는 지원된 grant 재사용 기능만 사용하고 문구만으로 새 grant를 만들지 않는다. 기능 부재는 해당 재시작만 보류한다.

## Task 권한에 결속된 개발 검수

개발 채널에서 Native 도구 `manage_showcase_test_build`가 실제 광고되면 현재 linked worktree를 소유하는 신뢰된 이 스킬의 호출과 현재 Task 권한으로만 진행하세요. list는 operation만, inspect는 operation과 candidateId만 전달하고 candidateRevision은 inspect에서 생략하세요. allocate에서만 candidateRevision/buildId/contractDigest를 함께 전달합니다. 검증된 terminal indeterminate가 nextOperation:null로 오면 같은 run을 보존하고 조회 반복을 멈추세요. list → inspect로 현재 작업본의 test 빌드를 확인한 뒤 allocate를 한 번 호출하고 nextOperation에 따라 bind·build·open을 진행하고 검수 뒤 stop·release를 진행하세요. remove는 요청 또는 이미 승인된 정리 범위에 포함된 경우에만 진행하세요. allocate의 slotOrdinal을 생략하면 쇼케이스가 빈 슬롯을 원자적으로 선택합니다. 사용자가 정확한 슬롯을 지정한 경우에만 slotOrdinal(1~8)을 전달하며 실패 시 다른 슬롯으로 바꾸지 마세요. pending 또는 결과 불명확은 같은 runId의 allocation-status 또는 status로만 조회하고 변경 요청을 재전송하지 마세요. 이 경로 전에 기존 handoff나 CLI 등록을 실행하지 마세요. Native 권한이 없거나 거절되면 다른 도구·파일로 가장하지 말고 해당 단계만 보류하세요. 운영팀도 같은 현재 Task·작업본·소유권 검증을 사용합니다. 외부 Host는 아래 승인된 Remote 기기 연결로 위임하며 Native 권한을 가장하지 않습니다. 이 개발 도구를 정식 배포 활성화로 해석하지 않습니다.


## 외부 CLI의 기존 Native 세션 위임

Node.js 26 이상(현재 검증 환경)에서 `node tools/collab-sidecar/showcase-worktree.mjs`를 사용합니다. 이 클라이언트는 로그인된 로컬 러너의 기존 Remote 기기 인증과 입력 경로를 재사용합니다. `DECAL_SESSION_ID`를 만들거나 Native 도구를 직접 호출하지 않습니다. 새 기기의 최초 연결은 기존 Desktop 기기 승인 화면에서 확인해야 합니다.

- `pair http://127.0.0.1:<포트> <기기파일>`: 현재 연결 화면의 일회 pairing nonce를 표준 입력으로 전달합니다. 기기파일은 새 전용 경로에 현재 사용자 전용 권한으로 보관합니다. nonce·키·ticket을 명령 인수나 로그에 남기지 않습니다.
- `list http://127.0.0.1:<포트> <기기파일>`: 승인된 연결의 세션 식별자·프로젝트 식별자·이름·상태·제어 가능 여부를 조회합니다.
- `run http://127.0.0.1:<포트> <기기파일> <세션ID> <프로젝트ID> [--remove]`: 사용자가 지정한 유휴 Native 세션에 이 내장 스킬만 전달합니다. 대상은 그 세션의 현재 Task와 연결된 작업본이며, 외부 CLI의 현재 디렉터리를 대신 등록하지 않습니다. 기존 제어권이 있어야 하며 다른 기기나 Desktop의 제어권을 가져오지 않습니다. 기본은 검수 뒤 정지·반납이며, `--remove`를 명시하면 이번 테스트 등록·산출물 제거도 요청합니다.

입력 접수는 작업 완료가 아닙니다. 이 호출의 입력 이후 실제 Host가 게시한 관리 도구 결과만 받아 같은 run의 상태를 출력합니다. 과거 기록·모델이 쓴 성공 문구는 완료 증거가 아닙니다. 연결 단절·시간 초과·결과 불명확 시 자동 재접속이나 재전송 없이 미확정으로 보고하고 기존 Desktop/Remote에서 실제 상태를 확인합니다. 기기 승인은 현재 Task·작업본·빌드 권한을 대신하지 않습니다.
