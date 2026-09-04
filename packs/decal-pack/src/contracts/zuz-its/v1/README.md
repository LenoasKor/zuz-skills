# ZUZ ITS compatibility contract v1

`zuz.its/v1`은 기존 Task·Work·Bug 저장소를 바꾸는 migration writer가 아니라 additive projection이다.

- Task의 내부 숫자 ID는 그대로 두고 사용자 표시만 `TASK-###`로 만든다.
- Work는 `WORK-###` 정식 티켓이며 현재 lifecycle·관계·정산을 유지한다.
- 기존 Bug는 파일 이동이나 재발급 없이 `ticketKind: issue`, `issueKind: bug`로 해석한다.
- `incident` identity는 Task 676의 `INC-###` 정본을 위해 예약하지만 이 계약은 Incident를 쓰지 않는다.
- 기존 `@decal-task|work|bug` 참조와 Task·Work·Bug v1~v6 계약 bytes를 변경하지 않는다.
- Office 업무, session work activity, Task Space는 ZUZ ITS Work와 별개다.

`project.mjs`는 이미 검증된 legacy projection을 입력으로 받아 identity와 표시 key만 더한다. 원래 title,
status, priority, `taskRefs`, settlement 값은 그대로 복사하므로 이 단계에서 데이터 변환이나 저장 쓰기는 없다.
