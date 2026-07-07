# Screenshot Archive

스크린샷을 자동으로 수집·아카이빙하고 URL로 공유할 수 있는 로컬 웹앱.

## 설치 방법

### 1. 저장소 클론

```bash
git clone https://github.com/shirleyh-h/screenshot-archive.git
cd screenshot-archive
```

### 2. 의존성 설치

```bash
npm install
```

### 3. 설정 실행

```bash
node setup.js
```

설정 항목:
- GitHub 사용자명 / 저장소 이름 (GitHub 동기화 원하는 경우)
- 서버 포트 (기본: 3100)
- 스크린샷 감시 폴더 (기본: ~/Desktop)
- 로그인 시 자동 실행 여부

### 4. 브라우저에서 열기

```
http://localhost:3100
```

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 자동 수집 | 지정 폴더에 이미지 저장 시 자동 아카이빙 |
| GitHub 동기화 | 이미지마다 GitHub raw URL 자동 생성 |
| 태그 | 이미지에 태그 추가, 태그별 필터 |
| 폴더 | 날짜 자동 분류 + 커스텀 폴더 |
| URL/이미지 복사 | 클릭 한 번으로 URL 또는 이미지 클립보드 복사 |
| 드래그&드롭 | 브라우저에 이미지 드래그해서 업로드 |

## 단축키 (이미지 모달)

| 키 | 동작 |
|----|------|
| `←` `→` | 이전/다음 이미지 |
| `E` | 이름 편집 |
| `⌘C` | URL 복사 |
| `Delete` | 이미지 삭제 |
| `Esc` | 닫기 |

## 수동 실행

```bash
npm start
```

## 요구 사항

- macOS
- Node.js 16 이상
- Git
