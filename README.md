# 로풀 법률 상담 — 외부 배포 버전

CrowTit 로풀(Lawful) Agent API(`api.crow-tit.com/v1/agent`)를 사용하는 법률 상담 웹앱입니다.
방문자는 API 키를 입력하지 않고, **운영자가 호스팅 환경 변수에 설정한 키**로 상담합니다.

> ⚠️ 이 답변은 AI가 판례·법령 코퍼스를 근거로 제공하는 일반 정보이며, 변호사의 법률 자문이 아닙니다.

## 구성

| 파일 | 역할 |
| --- | --- |
| `public/index.html` | 상담 화면(단일 페이지). 분야 칩 9개, 깊이(빠른/심층), 답변 방식, 스트리밍 답변, 출처 링크, 토큰 사용량, localStorage 상담 기록(검색·즐겨찾기·삭제) |
| `api/ask.js` | Vercel 서버리스 프록시. `POST /api/ask`(동기), `POST /api/ask?stream=1`(SSE 스트리밍). 키는 `process.env.CROWTIT_API_KEY`에서만 읽고 클라이언트에 절대 반환하지 않음 |
| `api/ask-stream.js` | `POST /api/ask-stream` 별칭 — `ask.js`를 스트리밍 모드로 호출 |
| `server.js` | 의존성 없는 Node http 서버. `public/` 정적 서빙 + `/api/ask`, `/api/ask-stream`, `/api/health` 프록시 (Render / Railway / VPS용) |
| `vercel.json` | `/api/*` 라우팅, 함수 최대 실행 시간 300초 |
| `package.json` | 의존성 없음, Node 18 이상 |
| `.env.example` | 자리 표시자만 있음 — 실제 키를 넣지 마세요 |
| `.gitignore` | `.env`, `node_modules/` 제외 |

## 0. 먼저 할 일 — 새 API 키 발급

1. https://console.crow-tit.com 에 로그인합니다.
2. API 키를 새로 발급받아 **그대로 복사**합니다. (채팅으로 주고받은 키는 복사 과정에서 문자가 바뀔 수 있습니다. 반드시 콘솔에서 직접 복사하세요.)
3. 이 키는 **절대 코드, README, 채팅, 공개 저장소에 붙여넣지 마세요.** 아래 배포 단계의 환경 변수에만 입력합니다.

## 1. Vercel 배포 (권장, 가장 간단)

1. 이 폴더를 GitHub 저장소에 올립니다. (`.env`는 올리지 않습니다. `.gitignore`에 이미 포함되어 있습니다.)
2. https://vercel.com → **Add New → Project** → 해당 저장소를 **Import**합니다.
3. **Environment Variables**에 아래를 추가합니다.
   - Name: `CROWTIT_API_KEY`
   - Value: 콘솔에서 복사한 새 키 (앞뒤 공백 없이 그대로)
   - Environment: Production에 체크
4. **Deploy**를 누릅니다.
5. 배포가 끝나면 나오는 URL(예: `https://legal-consult-xxx.vercel.app`)을 공유하면 됩니다. 방문자는 키 입력 없이 바로 상담할 수 있습니다.

> 참고: Vercel 무료(Hobby) 플랜은 함수 실행 시간이 최대 60초로 제한될 수 있습니다. 로풀 평균 응답은 30~60초라, 심층 분석이 간혹 타임아웃될 수 있습니다. 그 경우 **빠른 답변(quick)**을 쓰거나, 아래 Render/Railway 배포를 사용하세요. `vercel.json`에는 `maxDuration: 300`이 설정되어 있지만 유료 플랜에서만 적용됩니다.

## 2. Render / Railway 배포 (긴 답변에 유리)

1. 저장소를 Render(https://render.com) 또는 Railway에 연결합니다.
2. **Web Service**로 만들고 Start Command를 `node server.js`로 설정합니다.
3. Environment Variables에 `CROWTIT_API_KEY`를 위와 동일하게 설정합니다.
4. 배포 후 발급된 URL을 공유합니다.

## 3. 로컬 실행

```bash
cp .env.example .env
# .env 파일의 CROWTIT_API_KEY=ct_... 자리에 콘솔에서 복사한 키를 넣습니다.
node server.js
# http://localhost:3000 접속
```

또는 `.env` 없이 한 번만 실행하려면:

```bash
CROWTIT_API_KEY=콘솔에서_복사한_키 node server.js
```

## API 동작

- `POST /api/ask` — 본문 `{"question": "...", "depth": "deep"|"quick", "instructions": "..."}` → 응답 `{"answer": "...", "sources": [{"url": "..."}], "usage": {...}}`
- `POST /api/ask-stream` — 같은 본문으로 SSE 스트리밍 (`content_block_delta`의 `delta.text`, 마지막 `message_delta`의 `sources`/`usage`)
- `GET /api/health` — `{ok, keyConfigured, upstream}` (키는 값 자체를 반환하지 않습니다)
- 질문은 최대 45,000자, IP당 분당 10회로 제한됩니다.
- 키가 없으면 `500 server_misconfigured`, 키가 유효하지 않으면 `401 authentication_error`를 구조화된 JSON으로 반환합니다. 이 경우 호스팅 환경 변수의 키를 새 키로 교체하세요.

## ⚠️ 공유 전 주의사항

- **이 URL을 아는 사람은 누구나 운영자의 키/할당량을 사용합니다.** 링크를 공개 게시판 등에 올리지 말고, 믿을 수 있는 사람에게만 공유하세요.
- 키가 유출되었다고 의심되면 콘솔에서 키를 폐기하고 새로 발급받아 환경 변수를 교체하세요.
- 상담 기록은 방문자 각자의 브라우저(localStorage)에만 저장되며, 서버에는 저장되지 않습니다.
