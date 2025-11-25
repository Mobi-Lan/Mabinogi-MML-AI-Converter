# Vercel 배포 가이드

## 1. Vercel 계정 만들기
1. https://vercel.com/ 접속
2. GitHub 계정으로 로그인

## 2. 프로젝트 배포

### 방법 A: Vercel CLI 사용 (추천)

```bash
# Vercel CLI 설치
npm install -g vercel

# 서버 폴더로 이동
cd f:\mobi\server

# 배포 시작
vercel
```

첫 배포 시 질문에 답변:
- Set up and deploy? **Y**
- Which scope? (계정 선택)
- Link to existing project? **N**
- Project name? **mabinogi-mml-converter** (또는 원하는 이름)
- In which directory is your code located? **./**
- Want to override settings? **N**

### 방법 B: GitHub 연동 (더 쉬움)

1. GitHub에 코드 푸시
2. Vercel 대시보드에서 "New Project" 클릭
3. GitHub 저장소 선택
4. `server` 폴더를 Root Directory로 설정
5. Deploy 클릭

## 3. 환경 변수 설정

Vercel 대시보드에서:
1. 프로젝트 선택
2. Settings → Environment Variables
3. 다음 변수 추가:
   - `SUNO_API_KEY`: `10e9b5ca1c90dd1bd451d555fa5c1334`
   - `SUNO_BASE_URL`: `https://api.sunoapi.org/api/v1`

## 4. 배포 완료

배포가 완료되면 Vercel이 공개 URL을 제공합니다:
- 예: `https://mabinogi-mml-converter.vercel.app`

이 URL을 사용해서 Suno API가 파일에 접근할 수 있습니다!

## ⚠️ 중요 사항

**Vercel의 제한사항:**
- 파일 업로드는 `/tmp` 디렉토리에만 가능
- 서버리스 함수는 최대 실행 시간 제한 (무료: 10초, Pro: 60초)
- Suno API 폴링이 오래 걸리면 타임아웃 발생 가능

**대안:**
- Railway나 Render 사용 (서버리스가 아닌 일반 서버)
- 또는 Vercel Pro 플랜 사용
