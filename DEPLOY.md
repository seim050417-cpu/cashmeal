# 캐시밀 배포 가이드 (Render.com, 무료)

Git 명령어를 몰라도 됩니다. GitHub 웹사이트에서 파일을 드래그해서 올리고, Render 대시보드에서 몇 번 클릭하면 끝나요.

---

## 1단계. GitHub 계정 만들기 (이미 있으면 건너뛰기)

1. https://github.com/signup 접속
2. 이메일/비밀번호로 무료 계정 생성

## 2단계. 새 저장소(repository) 만들기

1. 로그인 후 오른쪽 위 **+** 버튼 → **New repository** 클릭
2. Repository name: `cashmeal-app` (원하는 이름으로 가능)
3. **Public** 또는 **Private** 아무거나 선택 (Private 추천 — 어차피 서비스키는 파일에 없음)
4. **Create repository** 클릭 (다른 옵션은 건드리지 않아도 됨)

## 3단계. 프로젝트 파일 업로드 (git 명령어 없이!)

1. 방금 만든 저장소 페이지에서 **uploading an existing file** 링크 클릭
   (또는 "Add file" → "Upload files")
2. 압축 풀어둔 `cashmeal-app` 폴더 안의 내용물을 **전부** 탐색기/파인더에서 선택해서
   그대로 브라우저 화면에 드래그 앤 드롭
   - ⚠️ `cashmeal-app` 폴더 자체가 아니라 **폴더 안의 파일들**(`server.js`, `package.json`, `public` 폴더 등)을 올려야 해요.
   - `.env` 파일은 올리지 않아도 됩니다 (올려도 실제 서비스키가 없는 템플릿이라 문제는 없지만, 어차피 배포 환경에서는 Render의 환경변수를 사용하므로 필요 없어요).
   - `.env`, `.gitignore` 처럼 점(.)으로 시작하는 파일은 macOS/Windows 탐색기에서 기본적으로 안 보일 수 있어요. 안 보이면 그냥 건너뛰어도 배포에는 전혀 문제없어요.
3. 아래 커밋 메시지는 그대로 두고 **Commit changes** 클릭

이제 GitHub에 프로젝트가 올라갔어요.

## 4단계. Render 계정 만들기

1. https://render.com 접속 → **Get Started** → **GitHub 계정으로 로그인**
2. GitHub 로그인 시 Render가 저장소에 접근하도록 권한을 요청하면 **Authorize** 클릭

## 5단계. Web Service 만들기

1. Render 대시보드에서 **New +** → **Web Service** 클릭
2. 방금 만든 `cashmeal-app` 저장소를 선택 → **Connect**
3. 아래처럼 입력 (대부분 자동으로 채워져요)
   - **Name**: `cashmeal-app` (원하는 이름)
   - **Region**: Singapore 등 가까운 지역
   - **Branch**: `main`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free** 선택

## 6단계. 서비스키 입력 (가장 중요) ⭐

1. 같은 화면 아래쪽 **Environment Variables** 섹션에서 **Add Environment Variable** 클릭
2. Key: `RDA_SERVICE_KEY` / Value: 공공데이터포털에서 발급받은 실제 서비스키 붙여넣기
3. (선택) Key: `PORT` 는 Render가 자동으로 관리하니 넣지 않아도 됩니다.

## 7단계. 배포

1. **Create Web Service** 클릭
2. 화면에 로그가 흐르면서 자동으로 `npm install` → `npm start`가 실행돼요 (2~5분 정도 걸려요)
3. 로그에 아래 메시지가 보이면 성공입니다.
   ```
   캐시밀 서버가 http://localhost:xxxx 에서 실행 중입니다.
   ✅ RDA_SERVICE_KEY 설정됨
   ```
4. 화면 위쪽에 `https://cashmeal-app-xxxx.onrender.com` 같은 실제 공개 주소가 생겨요. 이 주소가 배포된 사이트예요.

## 8단계. 테스트

배포된 주소 뒤에 아래를 붙여서 접속해보세요.

- `https://내주소.onrender.com/` → 캐시밀 앱 화면
- `https://내주소.onrender.com/api/health` → `keyConfigured: true` 확인
- `https://내주소.onrender.com/api/foods?name=김치찌개` → 실제 검색 결과 확인

---

## 참고사항

- **무료 요금제 특성**: 15분 동안 아무도 접속하지 않으면 서버가 잠들어요(sleep). 다시 접속하면 첫 요청은 30~50초 정도 걸려서 깨어나요. 이후에는 빠르게 동작합니다. 오류가 아니라 무료 요금제의 정상적인 동작이에요.
- **코드를 수정한 뒤 다시 배포하려면**: GitHub 저장소 페이지에서 수정할 파일을 열고 연필 아이콘(Edit)으로 고친 뒤 Commit만 하면, Render가 자동으로 감지해서 다시 배포해줘요. (Render의 "Auto-Deploy" 옵션이 기본 켜져 있어요.)
- **데이터 저장 위치**: 이 앱은 사용자 프로필/식사기록/포인트를 브라우저의 localStorage에 저장해요. 즉 접속한 기기·브라우저별로 따로 저장돼요(서버 DB가 아님). 여러 기기에서 같은 데이터를 보려면 나중에 별도의 로그인+서버 저장 기능이 필요해요.
- **서비스키를 나중에 바꾸고 싶다면**: Render 대시보드 → 해당 서비스 → **Environment** 탭에서 값만 수정하고 저장하면 자동으로 재시작돼요.
