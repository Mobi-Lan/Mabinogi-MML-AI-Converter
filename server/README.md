# Mabinogi MML Converter v8 (Server)

이 프로젝트는 Suno AI를 연동하여 오디오를 피아노 커버로 변환한 후 MML로 만들어주는 웹 애플리케이션입니다.

## 준비물
- **Node.js**: [공식 홈페이지](https://nodejs.org/)에서 설치 (LTS 버전 추천)
- **Suno API Key**: Suno API 키
- **ngrok 계정**: [ngrok.com](https://ngrok.com/)에서 무료 가입

## 설치 방법

1. 의존성 설치:
```bash
npm install
```

2. `.env` 파일 설정:
```env
PORT=3000
SUNO_API_KEY=여기에_API_키를_입력하세요
SUNO_BASE_URL=https://api.sunoapi.org/api/v1
NGROK_AUTH_TOKEN=여기에_ngrok_토큰을_입력하세요
```

3. ngrok 토큰 받기:
   - https://ngrok.com/ 에서 무료 가입
   - 대시보드에서 Auth Token 복사
   - `.env` 파일에 추가

## 실행 방법

**ngrok과 함께 실행 (Suno API 사용 시 필수):**
```bash
npm run start:ngrok
```

**일반 실행 (Suno API 사용 불가):**
```bash
npm start
```

## 왜 ngrok이 필요한가요?

Suno API는 업로드된 오디오 파일에 **인터넷에서 접근 가능한 공개 URL**이 필요합니다. 
로컬 서버(`localhost:3000`)는 내 컴퓨터에서만 접근 가능하므로, Suno 서버가 파일을 다운로드할 수 없습니다.

ngrok은 로컬 서버를 인터넷에 공개하는 안전한 터널을 만들어줍니다 (예: `https://abc123.ngrok.io`).

## 사용 방법

1. 서버 실행 후 브라우저에서 ngrok URL 접속 (콘솔에 표시됨)
2. 오디오 파일 업로드
3. "AI 피아노 커버 생성" 버튼 클릭
4. 변환 완료 후 MML 코드 복사

## 문제 해결

### "Server Error: SUNO_URL is not defined"
→ `.env` 파일에 `SUNO_BASE_URL`이 설정되어 있는지 확인

### "ETIMEDOUT" 에러
→ 네트워크 방화벽이 `api.sunoapi.org` 접속을 차단하고 있을 수 있습니다

### "Public URL not available"
→ ngrok 토큰이 `.env`에 올바르게 설정되어 있는지 확인
