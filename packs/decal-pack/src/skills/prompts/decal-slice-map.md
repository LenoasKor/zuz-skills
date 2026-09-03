---
id: decal-slice-map
label: 데칼 Task 관계도
version: 0.1.0
risk: read_only
group: 작업
target: active-cli
prompt_visibility: hidden
accepts_additional_input: true
template: 입력 끝에 "Decal app-precomputed Slice graph snapshot"이 있으면 앱이 이미 중심 Task의 최소 관계도를 표시했으므로 전체 Task catalog나 문서 본문을 다시 읽지 마세요. 제공된 1~2단계 node·edge·검사 결과만 사용해 필수 선행 차단, 권장 순서, 대체된 계획, 다음 착수 순서를 간결하게 설명하세요. 앱 snapshot이 없으면 사용자 입력에서 Task 번호와 선택 depth를 확인하고, docs/tasks/index.md가 있으면 해당 Task 문서의 Depends On·Follows·Supersedes와 직접 연결 문서만 읽으세요. docs/tasks/index.md가 없는 legacy 프로젝트에서만 docs/slices를 사용하세요. 관계가 없으면 현재 Task 요약과 연결 관계 없음을 명시하고, missing target·자기 참조·중복·필수 순환·폐기된 필수 선행은 수정하지 말고 진단으로 보고하세요. 읽기만 하고 파일·상태·Git을 변경하지 마세요.
---

# Task 관계도

중심 Task 번호를 입력합니다. 기본은 앞뒤 1단계이며 `--depth 2`를 붙이면 2단계까지 봅니다.

예: `/decal-slice-map 444 --depth 2`
