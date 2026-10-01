---
id: decal-debug
label: 데칼 체계적 디버깅
version: 0.3.0
risk: low_risk
group: 작업
target: active-cli
resources: REPEATING-WORK.md
template: 현재 버그나 오류를 체계적으로 디버깅해주세요. 증상·기대 결과·재현 조건을 확인하고 증거로 원인을 구분한 뒤 확인된 범위만 수정하세요. 국소 결함은 관련 소유 경로부터 조사합니다. 반복 실행의 빈도·수명·소비자·비용을 바꾸거나 누수·누적 부하·성능을 조사하면 코드 수정 전에 REPEATING-WORK.md companion를 반드시 읽고 부하·종료·전후 검증을 수행하세요. 직접 관련된 반복 경로의 검증은 국소 결함에서도 생략하지 마세요.
---

# 체계적 디버깅

증상 → 재현 → 가설 → 검증 → 원인 확정 → 최소 수정 순서로 버그를 해결합니다. 원인이 확정되기 전에 추측으로 코드를 바꾸지 않습니다.

## 기본 흐름

1. 관찰된 결과와 기대 결과를 정확히 적습니다.
2. 재현 조건, 빈도, 시작·종료 조건과 영향을 받는 표면을 확인합니다.
3. 증거로 구분할 수 있는 원인 가설을 필요한 만큼 세웁니다.
4. 각 가설을 가장 빠르고 부작용이 적은 방법으로 검증합니다.
5. 원인을 확정하고 요청 범위 안의 최소 수정을 설계합니다.
6. 수정 전후의 같은 관측값으로 결과를 비교합니다.

## 조사 범위와 필수 companion

문구·잘못된 분기·단일 파싱 같은 국소 결함은 관련 소유 경로부터 조사하며 관계없는 반복 작업 전수 조사를 요구하지 않습니다. 직접 관련된 반복 경로의 검증은 생략하지 않습니다.

타이머·polling·watcher·heartbeat·재귀 timeout·animation frame·주기적 Native/IPC/RPC·파일 감시·Remote publish의 빈도·수명·소비자·비용을 바꾸거나 누수·누적 부하·성능을 조사하면, 코드 수정 전에 `REPEATING-WORK.md`를 반드시 읽고 그 부하·종료·전후 검증을 수행합니다.

- `DECAL_SESSION_ID`가 있는 Decal 소유 세션은 광고된 읽기 전용 `decal_ui.read_canonical_skill({ skillId: "decal-debug", resourcePath: "REPEATING-WORK.md" })`로 읽습니다. Native 도구가 없으면 외부 host로 가장하지 않습니다.
- 외부 portable 세션은 이 Agent Skill과 같은 폴더의 `REPEATING-WORK.md`를 읽습니다. 공유 프롬프트 사본의 상대 경로는 `resources/decal-debug/REPEATING-WORK.md`입니다. 별도 원본 저장소 접근이나 네트워크 fetch를 요구하지 않습니다.
- companion의 expected SHA-256은 `sha256:3b8e0d8420f9bd1c71bfbee4642163fd865ba00e7a4faa4c066dccf25230f685`입니다. Native 결과의 digest 또는 설치된 파일 bytes를 대조합니다. 필수 파일이 없거나 digest가 다르면 관련 변경을 보존하고 Pack 갱신·참조 복구가 필요한 변경만 차단하며, 임의 fetch·추측 경로·불완전한 요약으로 대신하지 않습니다.
