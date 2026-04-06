# Poster Hand Sparkle Demo

포스터 원본 레이아웃은 이미지로 유지하고, 그 위에 손 감지 기반 픽셀 반짝임 레이어를 올린 데모입니다.

## 실행

정적 서버에서 실행하는 것을 권장합니다.

```powershell
cd C:\Users\user\OneDrive\문서\Playground
python -m http.server 4173
```

브라우저에서 `http://localhost:4173`를 열고 `카메라 켜기`를 누르면 됩니다.

## 구성

- `index.html`: 포스터와 캔버스 레이어 UI
- `styles.css`: 레이아웃과 분위기 스타일
- `app.js`: 포스터 색상 샘플링, 손 감지, 반짝임 애니메이션
- `assets/poster.png`: 원본 포스터 이미지
