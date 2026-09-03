---
id: decal-deploy
label: 데칼 배포
version: 0.2.2
risk: confirmation_required
group: 빌드/배포
target: active-cli
template: 프로젝트 명령과 배포 설정을 읽어 대상 환경과 표준 명령을 확인하세요. 운영 반영, 비용, 데이터베이스 이전(migration), 비밀값, 외부 서비스 영향을 분리해 설명하고 실행 직전에 소스 버전·대상 환경·계정·프로젝트·명령·영향과 DECAL_SESSION_ID 존재 여부를 다시 확인하세요. 사용자 안내는 `하려는 일`, `확인할 내용`, `영향`, `성공하면`, `확인`으로 쓰고 원시 명령과 예상 시간은 노출하지 마세요. Decal 소유 세션은 decal_ui.request_confirmation을 정확히 한 번 호출하고 도구가 없거나 등록이 거절되면 외부 fallback으로 가장하지 말고 host recovery를 따르세요. 외부 Codex/CLI host는 decal_ui를 호출하거나 패널을 가장하지 않고 같은 내용을 일반 텍스트로 승인받으세요. 승인 뒤 확인한 배포만 실행하고 실행 직전 전제가 달라지면 다시 승인받으세요. 외부 host라는 이유만으로 배포를 거절하지 마세요. 주소·식별자·결과는 `처리 결과`, `결과 및 후속`으로 보고하세요.
---

# 배포

Decal 소유 세션의 배포 확인은 `decal_ui.request_confirmation`으로 요청합니다. 외부 Codex/CLI host는 같은 대상·외부 영향을 일반 텍스트로 승인받은 뒤 동일한 재검증 규칙으로 실행합니다.

사용자에게는 내부 명령 대신 배포 대상과 외부 영향을 쉬운 말로 설명합니다.
