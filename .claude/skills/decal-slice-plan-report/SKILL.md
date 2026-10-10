---
name: decal-slice-plan-report
description: "데칼 슬라이스 계획진행 보고 규약을 프로젝트에서 실행합니다."
version: 0.2.5
---

# 데칼 슬라이스 계획진행 보고

## Repository authority boundary

Treat the Git root containing the invocation context as the only active project. A mention, link, dependency, companion repository, contract source, or shared Pack does not authorize access to another project. Before reading another project's contents beyond a root/product-identity probe, running a command there, or changing its files or Git state, obtain explicit approval from the current user that names the repository root and allowed operation scope for the current task. Verify the approved root independently, follow that repository's own instructions, and stop if identity or scope differs. Commit, push, deploy, delete, and other external effects are separate authorities unless the approval explicitly includes them.

docs/slices/index.md, docs/slices/category_index.md와 필요한 후보 문서를 읽고 계획 수립·논의·범위 확정이 필요한 Slice를 `현재 상황`, `바로 시작할 수 있는 작업`, `먼저 결정이 필요한 작업`, `추천`으로 보고하세요. planned와 backlog를 우선하고, in_progress라도 미결정 선택지·불명확한 범위·누락된 완료 조건·Context Budget·App.tsx 영향 계획·Slice 341 이후 누락된 Slice Category·Category Index·미해결 의존성으로 구현할 수 없으면 포함하세요. blocked는 재계획 후보로 만들지 말고 재개에 필요한 결정을 분리하세요. postponed는 사용자가 연기 작업 재검토를 명시하기 전까지 계획·현재 출시 추천 후보에서 제외하고, 재개할 때도 반드시 planned로 되돌려 최신 범위와 Remote 동등성을 다시 승인받으세요. 계획이 충분해 바로 개발 가능한 항목은 개발 보고 대상으로 넘기세요. 새 후속 Slice를 제안할 때는 category·영문 slug·title·priority·areas·summary·Context Budget을 포함한 body·version/Remote impact의 semantic intent만 제시하고, 임시 전역 번호·카테고리 순번·최종 파일명·index 링크 제목을 만들거나 정본을 직접 수정하지 마세요. 실제 등록의 전역 번호·Category Index·최종 파일명은 Native 또는 v10 register-task-batch broker만 발급합니다. 외부 host의 broker는 유일한 기존 canonical main worktree에서 실행하며 authority가 없거나 모호하면 수기 발급·checkout 전환으로 우회하지 말고 중단하세요. 이 계획 보고는 등록을 실행하거나 권한을 추가하지 않으며 Native 실패를 외부 fallback으로 바꾸지 마세요. 실제 세션 맥락, 같은 영역 계획 묶음, P0/P1, 후속 Slice 효과 순으로 최대 두 개를 고르세요. 추천이 있으면 일반 답변 뒤 decal_ui.recommend_slices 도구를 정확히 한 번 호출해 연기되지 않은 열린 Slice 번호, action plan, reason, 후보 문서 근거의 briefing을 items로 보내세요. 도구가 없거나 등록이 거절되면 태그나 대체 상호작용 문자열 없이 같은 의미의 일반 텍스트로 후보를 제시하고 직접 선택을 물으세요. 계획 문서와 상태는 수정하지 마세요. zuz ITS Task registry에서는 docs/tasks/index.md가 있으면 docs/tasks/index.md·docs/tasks/category_index.md·task_* 문서와 npm run task:*만 정본으로 사용하고, 앞의 docs/slices·slice:* 지시는 docs/tasks/index.md가 없는 legacy 프로젝트에만 적용하세요. 두 registry가 동시에 있으면 쓰기를 중단하고 충돌로 보고하세요.

# 슬라이스 계획진행 보고

계획·논의·범위 확정이 필요한 Slice를 선별하고, 필요할 때만 두 후보까지 신뢰된 추천 패널로 제시합니다.

보고는 `현재 상황`, `바로 시작할 수 있는 작업`, `먼저 결정이 필요한 작업`, `추천` 순서로 정리합니다.
