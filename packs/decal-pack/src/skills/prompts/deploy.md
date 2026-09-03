---
id: decal-deploy
label: 데칼 배포
version: 0.3.0
risk: confirmation_required
group: 빌드/배포
target: active-cli
template: 이 스킬만 실제 배포 목적의 official_release 경로를 열 수 있습니다. Decal 실행 컨텍스트의 프로젝트 출시 단계를 확인하고 빌드 전에 프로젝트 단계·검증 목적(deployment)·작업공간 종류·선택한 빌드 종류(official_release)를 표시하세요. 단계가 unset이면 선택을 요청하고 배포 빌드를 중단하세요. 릴리즈 후보 성공이나 Build ID를 SemVer 정산·설치·실행·배포 승인으로 취급하지 말고 기존 정산 영수증과 배포 gate를 모두 재검증하세요. 프로젝트 명령과 배포 설정을 읽어 대상 환경과 표준 명령을 확인하세요. 운영 반영, 비용, 데이터베이스 이전(migration), 비밀값, 외부 서비스 영향을 분리해 설명하고 실행 직전에 소스 버전·대상 환경·계정·프로젝트·명령·영향과 DECAL_SESSION_ID 존재 여부를 다시 확인하세요. 사용자 안내는 `하려는 일`, `확인할 내용`, `영향`, `성공하면`, `확인`으로 쓰고 원시 명령과 예상 시간은 노출하지 마세요. Decal 소유 세션은 decal_ui.request_confirmation을 정확히 한 번 호출하고 도구가 없거나 등록이 거절되면 외부 fallback으로 가장하지 말고 host recovery를 따르세요. 외부 Codex/CLI host는 decal_ui를 호출하거나 패널을 가장하지 않고 같은 내용을 일반 텍스트로 승인받으세요. 승인 뒤 확인한 배포만 실행하고 실행 직전 전제가 달라지면 다시 승인받으세요. 외부 host라는 이유만으로 배포를 거절하지 마세요. 주소·식별자·결과는 `처리 결과`, `결과 및 후속`으로 보고하세요.
---

# 배포

Decal 소유 세션의 배포 확인은 `decal_ui.request_confirmation`으로 요청합니다. 외부 Codex/CLI host는 같은 대상·외부 영향을 일반 텍스트로 승인받은 뒤 동일한 재검증 규칙으로 실행합니다.

사용자에게는 내부 명령 대신 배포 대상과 외부 영향을 쉬운 말로 설명합니다.

릴리즈 후보는 QA artifact일 뿐 공식 릴리즈가 아닙니다. 실제 배포는 `official_release`로만 분류하고 기존 정산 영수증·소스 결속·사용자 승인 경로를 그대로 통과해야 합니다.
