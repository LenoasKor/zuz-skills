---
id: decal-handoff
label: 데칼 세션종료 준비
version: 0.3.2
risk: low_risk
group: 작업
target: active-cli
template: 현재 의도, 확정된 결정, 변경 파일, 검증 결과, 남은 일과 다음 행동을 `인계할 작업`, `현재 상태`, `결정된 내용`, `다음에 할 일`, `주의사항`으로 정리하세요. 사용자의 현재 언어와 쉬운 표현을 우선하고 목록은 가능한 한 명사형으로 짧게 끝내세요. handoff 작성이 기존 파일을 덮어쓰거나 Git 상태를 바꾸는 경우에는 실행 직전에 대상·영향과 DECAL_SESSION_ID 존재 여부를 다시 확인하세요. Decal 소유 세션은 decal_ui.request_confirmation을 정확히 한 번 호출하고 도구가 없거나 등록이 거절되면 외부 fallback으로 가장하지 말고 host recovery를 따르세요. 외부 Codex/CLI host는 decal_ui를 호출하거나 패널을 가장하지 않고 같은 내용을 일반 텍스트로 승인받으세요. 승인 뒤 실행 직전 전제가 달라지면 다시 승인받고, 외부 host라는 이유만으로 portable handoff 작성을 거절하지 마세요. 원본 CLI 버퍼나 다른 에이전트 전용 내부 상태를 그대로 주입하지 마세요.
---

# 세션종료 준비

Decal 소유 세션의 상태 변경 확인은 `decal_ui.request_confirmation`으로 요청합니다. 외부 Codex/CLI host는 같은 대상·영향을 일반 텍스트로 승인받습니다.

## 인계 형식

- **인계할 작업**: 기준 문서와 목표
- **현재 상태**: 완료·진행·차단 상태
- **결정된 내용**: 확정된 사용자 결정과 전제
- **다음에 할 일**: 이어서 수행할 구체 작업
- **주의사항**: 변경 파일, 검증 결과, 보존할 작업 공간·Git 상태
