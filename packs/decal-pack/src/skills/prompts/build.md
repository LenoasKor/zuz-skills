---
id: decal-build
label: 데칼 빌드
version: 0.3.0
risk: low_risk
group: 빌드/배포
target: active-cli
template: 실행용 앱 artifact를 만드는 요청이면 Decal 실행 컨텍스트의 프로젝트 출시 단계와 정책 버전을 확인하고 검증 목적과 main/linked worktree를 공통 resolver에 적용하세요. 빌드 전에 프로젝트 단계·검증 목적·작업공간 종류·선택한 빌드 종류를 사용자에게 표시하세요. 단계가 unset이면 출시 전 또는 운영 중 선택을 요청하고 앱 빌드를 중단하며 Git·Task·배포 이력으로 추정하지 마세요. development는 main 개발빌드, isolated_test는 linked worktree A/B 테스트빌드, release_candidate는 릴리즈 후보 빌드만 사용하고 official_release는 이 스킬에서 실행하지 마세요. TypeScript·단위 테스트·비실행 웹 번들 검사는 이 분류와 별개입니다. 현재 프로젝트 설정에서 표준 빌드 명령을 읽기 전용으로 확인하고 가장 맞는 명령을 선택하세요. 기존 의존성으로 수행하는 표준 빌드는 실행할 수 있습니다. 새 의존성 설치, 잠금 파일 갱신, 생성물 추적, 대규모 파일 변경이 필요하면 실행 직전에 상태·정확한 명령·변경 파일·영향과 DECAL_SESSION_ID 존재 여부를 다시 확인하세요. 사용자 안내는 `하려는 일`, `확인할 내용`, `영향`, `성공하면`, `확인`으로 쓰고 원시 명령과 예상 시간은 노출하지 마세요. Decal 소유 세션은 decal_ui.request_confirmation을 정확히 한 번 호출하고 도구가 없거나 등록이 거절되면 외부 fallback으로 가장하지 말고 host recovery를 따르세요. 외부 Codex/CLI host는 decal_ui를 호출하거나 패널을 가장하지 않고 같은 내용을 일반 텍스트로 승인받으세요. 승인 뒤에만 확인한 추가 변경과 빌드를 실행하고, 실행 직전 전제가 달라지면 다시 승인받으세요. 외부 host라는 이유만으로 빌드를 거절하지 말고 배포는 실행하지 마세요. 릴리즈 후보는 Build ID만 발급하며 SemVer·정산·설치·실행·배포 권한을 바꾸지 않습니다. 결과는 `처리 결과`, `결과 및 후속`으로 짧게 보고하세요.
---

# 빌드

Decal 소유 세션의 상태 변경 확인은 `decal_ui.request_confirmation`으로 요청합니다. 외부 Codex/CLI host는 같은 대상·영향을 일반 텍스트로 승인받습니다.

사용자에게는 내부 명령 대신 확인할 빌드 대상과 변경 영향을 쉬운 말로 설명합니다.

## 프로젝트 단계 기반 선택

- `unset`: 모든 실행용 앱 빌드를 멈추고 Decal 프로젝트 설정에서 단계를 선택받습니다.
- `pre_live`: 명시적 릴리즈 조건 검증만 `release_candidate`; 그 외 main은 `development`, linked worktree는 `isolated_test`입니다.
- `live`: 공식 QA·최종 main 머지 후 검증·릴리즈 조건 검증은 `release_candidate`; 일반 구현은 main `development`, linked worktree `isolated_test`입니다.
- 실제 배포만 `official_release`이며 기존 정산 영수증과 배포 승인을 그대로 요구합니다.
