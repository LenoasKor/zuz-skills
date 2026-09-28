---
id: decal-debug
label: 데칼 체계적 디버깅
version: 0.2.0
risk: low_risk
group: 작업
target: active-cli
template: 현재 버그나 오류를 체계적으로 디버깅해주세요. 증상과 재현 조건을 확인하고 원인 가설을 빠르게 검증한 뒤 원인이 확정된 범위만 수정하세요. 타이머·폴링·watcher·heartbeat·주기적 IPC·파일 감시가 관련되면 코드를 수정하기 전에 기존 반복 작업 전체와 누적 호출량, 실행 스레드, I/O·렌더 부작용, 필요한 신선도와 종료 조건을 표로 확인하세요. 꼭 필요한 능동 감시만 작업 중 상태에 한정하고 이벤트·revision·deadline·on-demand 전환, background 실행, single-flight·dedupe·backoff로 대체할 계획을 먼저 세우세요.
---

# 체계적 디버깅

증상 → 재현 → 가설 → 검증 → 원인 확정 → 최소 수정 순서로 버그를 해결합니다. 원인이 확정되기 전에 추측으로 코드를 바꾸지 않습니다.

## 기본 흐름

1. 관찰된 결과와 기대 결과를 정확히 적습니다.
2. 재현 조건, 빈도, 시작·종료 조건과 영향을 받는 표면을 확인합니다.
3. 증거로 구분할 수 있는 원인 가설 2~3개를 세웁니다.
4. 각 가설을 가장 빠르고 부작용이 적은 방법으로 검증합니다.
5. 원인을 확정하고 요청 범위 안의 최소 수정을 설계합니다.
6. 수정 전후의 같은 관측값으로 결과를 비교합니다.

## 반복 작업 부하 게이트

타이머, polling, watcher, heartbeat, 재귀 timeout, animation frame loop, 주기적 Native·IPC·RPC 호출, 파일 감시, Remote publish가 관련되면 코드 작업 전에 아래 조사를 끝냅니다. 새 반복 작업 하나만 보지 말고 같은 상태를 읽거나 내보내는 기존 생산자와 소비자를 전체 경로에서 찾아 누적 부하를 계산합니다.

- 각 생산자의 소유자, trigger 또는 cadence, idle·active 조건, 인스턴스 수, 최악 호출량을 기록합니다.
- 실행 스레드와 한 번의 비용, 파일·디스크·네트워크·프로세스·IPC·렌더·저장 부작용, 소비자 fan-out을 기록합니다.
- 사용자에게 필요한 freshness, 늦어도 되는 시간, 종료·숨김·suspend·unmount 때의 정지 조건을 기록합니다.
- 기존 timer와 listener가 remount, 창, 세션 또는 프로젝트 수만큼 중복되는지 확인합니다.
- 이 근거와 변경 계획을 현재 작업 기록에 남긴 뒤 코드를 수정합니다. 측정할 수 없는 항목은 추정값과 한계를 구분합니다.

각 반복 작업은 다음 순서로 대안을 판단합니다.

1. 사용자 행동 시 on-demand 조회로 충분한지 확인합니다.
2. 상태 변경 event, callback, revision subscription 또는 listener로 바꿀 수 있는지 확인합니다.
3. 특정 시각에만 필요한 일은 상시 polling 대신 가장 가까운 exact deadline의 one-shot wake로 바꿉니다.
4. child exit, cancel, timeout, authority loss처럼 실행 중 빠른 반응이 필요하고 event 원천이 없는 감독만 active 상태에 한정한 bounded polling으로 남깁니다.

구현에서는 아래 경계를 지킵니다.

- 빠른 감독 tick과 전체 snapshot 구성·projection·publish를 분리하고, 전체 계산과 발행은 revision 또는 실제 상태 변화가 있을 때만 수행합니다.
- OS 상태 조회, 서명 검증, 파일 읽기·파싱처럼 막힐 수 있는 일은 UI·main thread 밖의 background 작업으로 옮깁니다.
- 조회 함수는 파일 쓰기나 publish를 몰래 수행하지 않게 하고, mutation 성공 지점이 event 또는 revision을 발행하게 합니다.
- 같은 상태에는 가능한 한 하나의 coordinator와 공유 store를 두고, listener를 먼저 연결한 뒤 initial snapshot을 읽습니다. 더 오래된 snapshot이 새 event를 덮어쓰지 못하게 revision을 비교합니다.
- single-flight로 겹친 실행을 막고, 같은 payload는 dedupe하며, event burst는 coalesce합니다.
- retry polling이 필요하면 pending·connecting 같은 구체 상태에만 적용하고 bounded backoff와 종료 조건을 둡니다. idle, 완료, 오류 확정, hidden, suspend, unmount에서는 멈춥니다.

수정 뒤에는 idle과 active를 나누어 호출 횟수, 겹친 실행, main-thread stall, 디스크 쓰기, IPC·네트워크 요청, render 수와 listener 수를 다시 관측합니다. hover·scroll 같은 사용자 입력이 반복 작업과 겹칠 때도 확인합니다. 기존 반복 작업 위에 새 timer를 얹지 않았고, 종료 뒤 호출이 남지 않으며, 필요한 상태 변화가 event 또는 제한된 감독 경로로 계속 전달된다는 증거를 남깁니다.
