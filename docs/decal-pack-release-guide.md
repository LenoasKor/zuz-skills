# Decal Pack 버전업·배포 가이드

이 문서는 Decal Pack을 한 번 고치고 끝내는 작업이 아니라, 정본 변경부터 실제 소비 프로젝트 갱신까지 같은 순서로 반복하기 위한 운영 체크리스트다.

## 한눈에 보는 순서

1. 변경 범위와 호환성 판단
2. `zuz-skills` 정본 수정
3. 정본 전체 검증과 source commit
4. commit SHA에 결속한 결정적 Pack 빌드
5. GitHub tag·Release 발행
6. `skills.zuz.dev` 검증·서명 공개
7. Decal 내장 고정본·설치기 갱신
8. Primer·Jig 고정 소비본 갱신
9. 일반 설치 프로젝트의 수정본 보호 갱신
10. 공개 카탈로그와 소비자 상태 확인 후 작업 정산

중간 단계의 성공을 전체 배포 완료로 부르지 않는다. GitHub Release, Store 공개, Decal 내장, 고정 소비자, 일반 설치 프로젝트는 서로 다른 배포 단계다.

## 1. 시작 전 확인

- 제품명 `Decal`, 조직명 `zuz.dev`, 저장소명 `zuz-skills`의 표기를 확인한다. 사용자 노출에서 `zuz`는 소문자를 사용한다.
- 새 기능이면 Task, 유계 개선이면 Work, 기존 계약과 다른 결함이면 Bug를 각 대상 저장소 규약에 먼저 등록한다.
- Pack source 변경과 소비 프로젝트 변경은 서로 다른 저장소 작업이다. 한 저장소의 티켓이나 승인으로 다른 저장소 파일을 조용히 수정하지 않는다.
- 이미 발행한 계약·tag·Release의 bytes는 수정하지 않는다. 호환 보강은 새 계약 버전과 새 Pack 버전으로 추가한다.
- Pack SemVer는 기존 설치와 호환되는 결함 복원은 patch, 기존 모듈 안의 선택 기능 추가는 minor, 설치 구성을 새 모듈로 분리하거나 기존 기본 선택을 바꾸는 변화는 major를 기본으로 한다.
- 폐기할 release는 삭제하거나 같은 tag로 교체하지 않고 revocation 또는 deprecated 상태를 새 manifest에 기록한다.

## 2. `zuz-skills` 정본 수정

정본은 `packs/decal-pack/src/`와 `packs/decal-pack/pack.source.json`이다.

- 스킬 문서를 바꾸면 해당 스킬 version과 `minimumCompatible`을 함께 갱신한다.
- 계약을 추가하면 이전 공개 계약 bytes를 유지하고 새 `contracts/.../vN`을 만든다.
- `packVersion`, `compatibility`, `capabilities`, 실행 정책을 실제 변화와 맞춘다.
- 각 모듈의 독립 `version`, `digest`, 파일 수가 manifest에 결속되는지 확인한다.
- Codex·Claude·Gemini·ACP가 같은 사용자 의미를 갖는지 확인한다.
- Decal·Primer·Jig와 네 공급자 acceptance fixture에 새 필수 동작을 추가한다.
- LICENSE·NOTICE와 Apache-2.0 경계를 유지한다.

`dist/` 파일을 직접 편집하지 않는다. source 변경이 끝나기 전에 release artifact를 만들지 않는다.

## 3. 정본 검증과 source commit

```sh
npm run verify:source
npm test
git diff --check
```

모두 통과한 뒤 source 파일만 정확히 커밋한다. 다른 세션의 변경, 빌드 산출물, 소비 프로젝트 파일을 섞지 않는다.

```sh
git rev-parse HEAD
```

이 40자리 commit이 Pack의 `sourceRevision`이다. source를 커밋한 뒤 다시 수정했다면 이전 build를 버리고 새 commit으로 다시 시작한다.

## 4. 결정적 Pack 빌드

```sh
npm run build:decal-pack -- --source-revision <40자리-source-commit>
```

생성 결과에서 다음 값을 한 영수증으로 기록한다.

- Pack version
- source commit
- manifest identity digest (`manifestSha256`)
- manifest 파일 자체의 SHA-256
- package SHA-256
- 파일 수와 스킬 수

같은 commit과 source bytes로 한 번 더 빌드했을 때 digest가 같아야 한다. manifest의 `sourceRevision`과 현재 `HEAD`가 다르면 발행하지 않는다.

## 5. GitHub Release 발행

- tag 형식은 `decal-pack-v<version>`이다.
- tag는 기록한 source commit을 정확히 가리켜야 한다.
- Release에는 같은 빌드에서 나온 manifest와 `.zuz-pack.json`을 올린다.
- 업로드 뒤 내려받은 asset SHA-256이 로컬 영수증과 같은지 확인한다.
- 기존 tag나 asset을 덮어쓰지 않는다.

## 6. Skill Store 공개

`https://skills.zuz.dev/admin`의 **공식 Decal Pack 릴리스**에 GitHub tag만 입력해 검증·서명 공개를 실행한다.

- Store가 GitHub asset을 다시 읽고 source, license, manifest, package digest와 격리 검사를 모두 통과해야 한다.
- 완료 메시지의 불변 Store release ID를 기록한다.
- 공개 카탈로그에서 공식 Pack 카드의 version, source commit, 라이선스와 상세 문서를 확인한다.
- GitHub Release가 있어도 Store 카드가 이전 version이면 Store 배포는 미완료다.

## 7. Decal 내장본 갱신

Decal 저장소에서는 공개 package bytes를 동기화한다. source tree 파일을 수동 복사해 배포본을 재구성하지 않는다.

```sh
node scripts/sync_zuz_skills_decal_pack.mjs --write --source-root <zuz-skills-checkout>
node scripts/sync_zuz_skills_decal_pack.mjs --check
npm run test:zuz-skills-pack
npm run test:portable-task-work-bug-skills
```

새 contract 파일이 생겼다면 `src-tauri/src/project_skill_installation.rs`의 설치 목록과 관련 검증을 함께 갱신한다. Pack manifest만 바꾸고 설치 목록을 빠뜨리면 앱 화면에는 새 version이 보여도 생성 프로젝트에는 계약이 누락된다.

그 뒤 TypeScript build와 관련 Rust 설치 테스트를 통과시킨다. Decal 제품 SemVer 영향은 Pack version과 별도로 해당 zuz ITS 티켓 정책에서 판정한다.

## 8. Primer·Jig 고정 소비본 갱신

Primer와 Jig는 런타임에 `zuz-skills` checkout이나 네트워크를 읽지 않고 검증된 Pack archive를 자체 고정 사본으로 가진다.

- 각 저장소에 Pack 채택 Task 또는 Work를 먼저 등록한다.
- 해당 저장소의 동기화 스크립트에 새 tag·commit·digest·version을 고정한다.
- manifest/package 고정본과 선택 소비자 계약·스킬 projection을 함께 갱신한다.
- `primer-embedded-v1`, `jig-embedded-v1` fixture와 저장소 자체 검증을 통과시킨다.
- 제품 UI나 제품 SemVer가 바뀌지 않는 소비본 갱신인지 별도로 판단한다.

Showcase처럼 Pack 전체를 고정 내장하지 않고 일반 프로젝트 설치본을 쓰는 제품은 이 단계가 아니라 다음 설치 프로젝트 단계에서 다룬다.

## 9. 일반 설치 프로젝트 갱신

각 프로젝트에서 먼저 installer dry-run을 실행하고 그 프로젝트의 기존 lock과 선택 module/provider를 유지한다. 모듈 구성을 바꾸려면 같은 installer의 `change-modules` 계획을 별도로 미리 보고 적용한다.

- `current`: 쓰지 않는다.
- `update_available`: exact 계획 digest를 승인된 설치 동작으로 적용한다.
- `modified`: 자동 덮어쓰지 않고 diff와 수동 선택을 안내한다.
- `incompatible` 또는 `security_blocked`: 해당 portable 기능만 fail-closed한다.
- 더 이상 선택하지 않은 모듈의 수정 없는 관리 파일은 발견 경로 밖 `.decal/retired/decal-project-pack/`으로 옮긴다.
- 사용자 수정본·symlink·활성 등록/정산 journal이 있으면 제거하지 않고 차단 사유를 보고한다.
- `zuz-its` 제거는 기존 zuz ITS 티켓 문서를 한 byte도 바꾸지 않는다.
- `zuz-its` 재설치는 기존 기록 채택 목록을 preview에 표시한 뒤에만 도구를 복원한다.
- 현 Pack에서 출처를 판별할 수 없는 obsolete 관리 파일은 자동 삭제하지 않고 만료·미사용 상태로 보고한다.

갱신 뒤 lock의 Pack version과 `contracts/task-work-bug/v10/verify-contract.mjs` 같은 새 필수 파일을 확인하고 installer dry-run이 다시 `current`인지 검증한다.

### 필수 전파 매트릭스

현재 Decal Pack 릴리스는 아래 8개 프로젝트를 필수 소비자로 확인한다. 한 곳이라도 결과가 없으면
전파 완료로 보고하지 않는다.

| 소비 프로젝트 | 적용 방식 | 필수 확인 |
| --- | --- | --- |
| Decal | 전체 내장본 + 저장소 ITS 스킬 | Pack snapshot, Native 설치 목록, v10 계약 |
| Primer | 전체 고정 사본 + 선택 소비 projection | manifest/package digest, consumer fixture, v10 계약 |
| Jig | 전체 고정 사본 + 선택 소비 projection | source ledger, consumer fixture, v10 계약 |
| Showcase | 프로젝트 ITS 소비본 | 네 공급자 스킬, v9/v10, zuz ITS v3 |
| zuz.dev Mobile | 프로젝트 ITS 소비본 | 네 공급자 스킬, v9/v10, zuz ITS v3 |
| zuz.dev Hub | 프로젝트 ITS 소비본 | 프로젝트 전용 구계약 보존, 필요한 후속 계약, v10 |
| 살림비서 | 설치 lock 기반 관리본 | lock의 version/digest, 모든 관리 파일 digest, v10 |
| STANZA | 프로젝트 ITS 소비본 | 네 공급자 스킬, v9/v10, zuz ITS v3 |

각 결과에는 적용 branch와 commit을 기록한다. 작업 중 feature branch에만 적용된 경우에는 해당
Pack 전용 commit을 canonical main에도 별도로 반영·검증하거나, main 미반영을 명시적인 미완료로
남긴다. 활성 feature worktree를 main으로 바꾸는 방식은 사용하지 않는다.

## 10. worktree와 ITS 발급 안전 규칙

feature 또는 detached worktree에서 티켓을 등록할 때 현재 작업공간을 main으로 switch/detach하지 않는다. 임시 main worktree를 만들고 나중에 반납하는 방식도 사용하지 않는다.

- Task 등록: `contracts/task-work-bug/v10/register-task-batch.mjs`
- Work·Bug·Incident 등록: `contracts/task-work-bug/v10/register-ticket.mjs`
- lifecycle·정산: 기존 `v9` runner

v10 broker는 동일 저장소에서 이미 canonical `main` 또는 `master`를 소유한 작업공간 하나를 찾아 등록만 위임한다. main 작업공간이 없거나 둘 이상으로 모호하면 `main_worktree_required` 또는 `main_worktree_ambiguous`로 멈춘다. 이때 checkout을 바꾸거나 새 worktree를 만들어 우회하지 않는다.

## 11. 마감 검증과 정산

최종 보고에는 아래를 한 번에 남긴다.

- `zuz-skills` source commit과 GitHub tag/Release
- 세 digest와 Pack 파일·스킬 수
- Store 불변 release ID와 공개 카드 확인
- Decal 내장 commit과 설치기/빌드 검증
- Primer·Jig 채택 commit 또는 명시적인 미완료 사유
- 일반 설치 프로젝트별 `current`/`modified`/차단 결과
- 사용자 수정본·다른 세션 dirty 파일을 보존했다는 확인
- zuz ITS lifecycle, 제품 version 적용 여부와 남은 Smoke

모든 필수 소비자가 확인되기 전에 source build 성공만으로 “배포 완료”라고 보고하지 않는다.

## 자주 발생한 실수

- source commit 전에 artifact를 만들어 `sourceRevision`이 stale해짐
- manifest만 갱신하고 Decal Rust 설치 목록에서 새 계약을 누락함
- Store import를 빼먹어 공개 카드가 이전 version에 머묾
- Primer·Jig의 hard-coded tag/digest와 fixture를 일부만 갱신함
- 일반 프로젝트의 수정된 스킬을 새 Pack으로 덮어씀
- ITS 제거를 기록 문서 삭제로 오해하거나, 활성 정산 중 도구를 먼저 제거함
- Pack version과 Decal/Primer/Jig 제품 SemVer를 같은 것으로 취급함
- feature worktree를 main으로 바꾸거나 기본 폴더를 detached 상태로 남김
- 기존 release를 삭제하거나 같은 tag의 bytes를 교체함
- GitHub, Store, Decal, 고정 소비자, 설치 프로젝트 중 한 단계만 끝내고 전체 완료로 보고함
