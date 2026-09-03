---
id: decal-push-ready
label: 데칼 푸시
version: 0.3.2
risk: confirmation_required
group: 저장소
target: active-cli
template: 변경 이력, 원격 기준, 원격 저장소·브랜치, 아직 전송하지 않은 커밋, 강제 전송 또는 새 원격 기준 설정 여부를 읽기 전용으로 확인하세요. 실행 직전에 브랜치·작업 공간(worktree), 정확한 원격 대상과 명령을 다시 확인하세요. 사용자 안내는 `하려는 일`, `확인할 내용`, `영향`, `성공하면`, `확인`으로 쓰고 원시 명령과 예상 시간은 노출하지 마세요. 먼저 DECAL_SESSION_ID의 존재 여부로 host를 판정하세요. Decal 소유 세션에서는 decal_ui.request_confirmation 도구를 정확히 한 번 호출하고 등록 뒤 사용자 결정을 기다리며, 도구가 없거나 등록이 거절되면 외부 fallback으로 가장하지 말고 host recovery를 따르세요. 외부 Codex/CLI host에서는 decal_ui를 호출하거나 패널·태그 문자열을 출력하지 말고 같은 내용을 일반 텍스트로 승인받으세요. 승인 뒤 표시한 원격 전송만 실행하고 실행 직전 전제가 달라지면 다시 승인받으세요. 외부 host라는 이유만으로 원격 전송을 거절하지 말고, 강제 전송은 별도 확인 없이는 하지 마세요. 결과는 `처리 결과`, `결과 및 후속`으로 보고하세요.
---

# 데칼 원격 전송

Decal 소유 세션의 원격 전송 확인은 `decal_ui.request_confirmation`으로 요청합니다. 외부 Codex/CLI host는 같은 대상·외부 영향을 일반 텍스트로 승인받은 뒤 동일한 재검증 규칙으로 실행합니다.
