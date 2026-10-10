# ZUZ ITS v2 — Incident ticket contract

이 계약은 `zuz.its/v1` 위에 `INC-###` 장애 티켓을 추가한다.

- 정본 경로: `docs/work-items/incidents/INC-<3자리 이상>.md`
- schema: `zuz.its.incident-ticket`, schemaVersion `1`
- 상태 흐름은 기존 Bug와 같은 `new → confirmed → in_progress → development_complete → release_ready → closed`를 사용한다.
- Bug와 Incident는 모두 Issue지만 ID·파일·번호 공간은 서로 독립적이다.
- Remote에는 영향도, 분류 태그, 영향 서비스 개수, 복구 단계만 전달한다. 서비스명, 장애 시각, 복구 증거 원문은 Desktop/project 정본에만 둔다.
- 모든 create/update는 일반 파일·symlink·revision·중복 ID를 재검증한다.

`register-incident.mjs`는 dry-run 뒤 source revision을 결속한 create만 수행하고,
`transition-incident.mjs`는 순방향·blocked 복귀·완료 근거·종결 사유를 검증한다.
