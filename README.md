# eCRF PWA (Electronic Case Report Form - Progressive Web Application)

## 프로젝트 개요

- **프로젝트명**: eCRF PWA
- **버전**: 2.0.0
- **목적**: 임상시험에서 환자 데이터를 전자적으로 수집, 관리하는 PWA 시스템
- **핵심 원칙**: 데이터 정확성(Integrity)과 추적 가능성(Traceability)
- **기술 스택**: Hono + TypeScript + Cloudflare Pages + D1 Database
- **규제 준수**: 21 CFR Part 11, CDISC 표준 지원 목표

## 🚀 현재 개발 상태

### ✅ Phase 1: 기본 MVP (완료)

| 기능 | 상태 | 설명 |
|------|------|------|
| 프로젝트 초기 설정 | ✅ 완료 | Hono + Cloudflare Pages 환경 구성 |
| 사용자 인증 시스템 | ✅ 완료 | 역할 기반 접근 제어 (RBAC), 세션 관리 |
| Study 관리 | ✅ 완료 | Study CRUD, 상태 관리, Lock 기능 |
| Site 관리 | ✅ 완료 | Site 목록/등록/상세, PI 배정 |
| Subject 관리 | ✅ 완료 | 피험자 등록/목록/상세, 중도탈락 처리 |
| Visit 관리 | ✅ 완료 | 방문 일정, Visit별 CRF 상태 |
| 동적 CRF 폼 시스템 | ✅ 완료 | Visit별 데이터 수집, 필드 정의 기반 렌더링 |
| 데이터 검증 | ✅ 완료 | 필수/범위/논리 검증, 실시간 피드백 |
| Audit Trail | ✅ 완료 | 21 CFR Part 11 준수 감사 로그 |
| Query 관리 | ✅ 완료 | Query 생성/답변/종료, 우선순위 관리 |
| 전자서명 | ✅ 완료 | CRF 완료/승인 서명, 비밀번호 확인 |
| 대시보드 | ✅ 완료 | Study/Site/Subject/Query 통계 |

### ✅ Phase 2: 고급 기능 (완료)

| 기능 | 상태 | 설명 |
|------|------|------|
| 고급 Edit Check | ✅ 완료 | Cross-Field 검증, Range 검증, Cloudflare 호환 조건 평가기 |
| Data Lock/Freeze | ✅ 완료 | Subject/Visit/Site/Study 레벨 데이터 잠금, Lock 이력 관리 |
| Data Export (CSV/JSON) | ✅ 완료 | Subject, CRF Data, Query, Audit Trail Export |
| CDISC Export | ✅ 완료 | SDTM Domain Export (DM, VS, AE 등), ODM XML 포맷 |
| 리포트/대시보드 강화 | ✅ 완료 | 등록 현황, Query 통계, CRF 진행률, Site 성과 |

### ✅ Phase 3: PWA 고도화 (완료)

| 기능 | 상태 | 설명 |
|------|------|------|
| 오프라인 지원 | ✅ 완료 | Service Worker v2 + IndexedDB 캐싱 |
| 동기화 시스템 | ✅ 완료 | 충돌 감지/해결, 동기화 대시보드 |
| 데이터 프리페치 | ✅ 완료 | 오프라인 CRF 작업용 데이터 다운로드 |
| 동기화 대시보드 | ✅ 완료 | 실시간 상태, 이력, 충돌 관리 UI |

### 🔄 Phase 4: 보안/모바일 강화 (진행 예정)

| 기능 | 상태 | 설명 |
|------|------|------|
| 모바일 최적화 | ⏳ 대기중 | 터치 인터페이스 최적화 |
| 보안 강화 | ⏳ 대기중 | 2FA, 다층 암호화 체계 |
| Push 알림 | ⏳ 대기중 | Query/Signature 알림 |

---

## 📱 주요 URL

| 환경 | URL |
|------|-----|
| 개발 서버 | https://3000-i0ilh3vkiqhkaklutbvcp-c07dda5e.sandbox.novita.ai |
| 로컬 개발 | http://localhost:3000 |
| 프로덕션 | https://ecrf-pwa.pages.dev (예정) |

---

## 👥 사용자 역할 및 테스트 계정

### 역할 정의

| 역할 | 코드 | 주요 권한 |
|------|------|----------|
| **PI (책임연구자)** | `PI` | 모든 데이터 조회, 최종 승인, 전자서명 |
| **Sub-Investigator (공동연구자)** | `SUB_INV` | 데이터 입력/조회, 부분 승인 |
| **CRC (연구간호사)** | `CRC` | 일상적 데이터 입력/수정 |
| **CRA (모니터)** | `CRA` | 데이터 조회, Query 발행 (수정 불가) |
| **Data Manager** | `DM` | 전체 데이터 관리, Export, Lock/Unlock |
| **System Admin** | `ADMIN` | 시스템 설정, 사용자 관리 |

### 테스트 계정 (비밀번호: Test1234!)

| 역할 | 이메일 |
|------|--------|
| 시스템 관리자 | admin@ecrf.local |
| 책임연구자 (PI) | pi@hospital1.local |
| 공동연구자 | subinv@hospital1.local |
| 연구간호사 (CRC) | crc@hospital1.local |
| 모니터 (CRA) | cra@sponsor.local |
| 데이터 관리자 | dm@sponsor.local |

### 권한 매트릭스

| 기능 | PI | SUB_INV | CRC | CRA | DM | ADMIN |
|------|:--:|:-------:|:---:|:---:|:--:|:-----:|
| 데이터 조회 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 데이터 입력 | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| 데이터 수정 | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| 최종 서명 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Query 발행 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Query 답변 | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| Data Export | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Data Lock | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| 사용자 관리 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## 📊 데이터 아키텍처

### Study/Site/Subject 계층 구조

```
Study (임상시험)
├── Protocol Info (프로토콜 정보)
├── Visit Schedule (방문 일정)
│
├── Site 1 (기관 1)
│   ├── Subject 001
│   │   ├── Visit: Screening
│   │   │   ├── Demographic CRF
│   │   │   ├── Medical History CRF
│   │   │   └── Vital Signs CRF
│   │   ├── Visit: Baseline
│   │   └── Visit: Week 4...
│   ├── Subject 002
│   └── Subject 003
│
├── Site 2 (기관 2)
│   └── ...
│
└── Site N (기관 N)
```

### 데이터베이스 스키마 (D1)

- **users**: 사용자 정보 및 인증
- **sessions**: 로그인 세션 관리
- **studies**: 임상시험 정보
- **visit_schedules**: 방문 일정 정의
- **form_definitions**: CRF 양식 정의
- **field_definitions**: CRF 필드 정의
- **sites**: 연구 기관
- **site_users**: 기관-사용자 배정
- **subjects**: 피험자
- **visits**: 방문 기록
- **crf_instances**: CRF 인스턴스
- **crf_data**: CRF 데이터 값
- **queries**: 데이터 질의
- **query_responses**: Query 응답
- **electronic_signatures**: 전자서명
- **audit_logs**: 감사 추적
- **data_locks**: 데이터 잠금

### 저장 서비스

| 데이터 유형 | 저장소 | 설명 |
|------------|--------|------|
| 관계형 데이터 | **Cloudflare D1** | 모든 핵심 비즈니스 데이터 |
| 세션/캐시 | **Cloudflare KV** | 로그인 세션, 임시 데이터 |
| 첨부파일 | **Cloudflare R2** | PDF, 이미지 등 첨부 문서 |
| 오프라인 데이터 | **IndexedDB** | PWA 로컬 저장 |

---

## 🔌 API 엔드포인트

### 인증 API
| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/auth/login` | 사용자 로그인 |
| POST | `/api/auth/logout` | 로그아웃 |
| POST | `/api/auth/refresh` | 토큰 갱신 |
| GET | `/api/auth/me` | 현재 사용자 정보 |

### Study API
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/studies` | Study 목록 조회 |
| GET | `/api/studies/:id` | Study 상세 조회 |
| POST | `/api/studies` | Study 생성 |
| PUT | `/api/studies/:id` | Study 수정 |
| POST | `/api/studies/:id/lock` | Study Lock |
| GET | `/api/studies/:id/stats` | Study 통계 |

### Site API
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/studies/:studyId/sites` | Site 목록 |
| GET | `/api/sites/:id` | Site 상세 |
| POST | `/api/studies/:studyId/sites` | Site 추가 |
| PUT | `/api/sites/:id` | Site 수정 |

### Subject API
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/sites/:siteId/subjects` | Subject 목록 |
| GET | `/api/subjects/:id` | Subject 상세 |
| POST | `/api/sites/:siteId/subjects` | Subject 등록 |
| PUT | `/api/subjects/:id` | Subject 수정 |
| POST | `/api/subjects/:id/withdraw` | 중도탈락 처리 |

### Visit/CRF API
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/subjects/:subjectId/visits` | Visit 목록 |
| GET | `/api/visits/:id` | Visit 상세 (CRF 포함) |
| PUT | `/api/visits/:id` | Visit 수정 |
| POST | `/api/visits/:id/crf` | CRF 데이터 저장 |
| POST | `/api/visits/:id/crf/:formCode/complete` | CRF 완료 |

### Query API
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/queries` | Query 목록 (필터 지원) |
| GET | `/api/queries/:id` | Query 상세 |
| POST | `/api/queries` | Query 생성 |
| POST | `/api/queries/:id/answer` | Query 답변 |
| POST | `/api/queries/:id/close` | Query 종료 |
| POST | `/api/queries/:id/cancel` | Query 취소 |

### Signature API
| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/signatures` | 전자서명 생성 |
| GET | `/api/signatures/crf/:crfInstanceId` | CRF 서명 조회 |

### Edit Check API
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/edit-checks/presets` | 프리셋 규칙 목록 조회 |
| GET | `/api/edit-checks/rules?studyId=` | 규칙 목록 조회 |
| GET | `/api/edit-checks/rules/:id` | 규칙 상세 조회 |
| POST | `/api/edit-checks/rules` | 규칙 생성 (ADMIN/DM) |
| PUT | `/api/edit-checks/rules/:id` | 규칙 수정 (ADMIN/DM) |
| DELETE | `/api/edit-checks/rules/:id` | 규칙 비활성화 (ADMIN/DM) |
| POST | `/api/edit-checks/execute` | CRF 검증 실행 |

### Data Lock API
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/locks` | Lock 목록 조회 |
| GET | `/api/locks/stats` | Lock 통계 조회 |
| GET | `/api/locks/status/:recordType/:recordId` | Lock 상태 확인 |
| GET | `/api/locks/history/:recordType/:recordId` | Lock 이력 조회 |
| POST | `/api/locks` | Lock 생성 (DM 권한) |
| POST | `/api/locks/:id/unlock` | Unlock (DM 권한) |

### Data Export API
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/exports/summary?study_id=` | Export 가능 데이터 요약 |
| GET | `/api/exports/subjects?study_id=&format=` | Subject 데이터 Export |
| GET | `/api/exports/crf-data?study_id=&format=` | CRF 데이터 Export (Long) |
| GET | `/api/exports/crf-wide?study_id=&form_code=&format=` | CRF 데이터 Export (Wide) |
| GET | `/api/exports/queries?study_id=&format=` | Query Export |
| GET | `/api/exports/audit-trail?study_id=&format=` | Audit Trail Export |

### Audit API
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/audit/logs` | 감사 로그 조회 |

### System API
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/health` | 헬스 체크 |

---

## 📁 프로젝트 구조

```
webapp/
├── src/
│   ├── index.tsx              # 메인 앱 엔트리
│   ├── renderer.tsx           # JSX 렌더러
│   ├── routes/
│   │   ├── auth.ts            # 인증 API
│   │   ├── studies.ts         # Study API
│   │   ├── sites.ts           # Site API
│   │   ├── subjects.ts        # Subject API
│   │   ├── visits.ts          # Visit/CRF API
│   │   ├── queries.ts         # Query API
│   │   ├── signatures.ts      # 전자서명 API
│   │   ├── editchecks.ts      # Edit Check API
│   │   ├── locks.ts           # Data Lock API
│   │   └── exports.ts         # Data Export API
│   ├── middleware/
│   │   ├── auth.ts            # 인증 미들웨어
│   │   └── rbac.ts            # 권한 검증
│   ├── services/
│   │   ├── auth.service.ts    # 인증 서비스
│   │   ├── audit.service.ts   # 감사 서비스
│   │   ├── validation.service.ts # 검증 서비스
│   │   └── editcheck.service.ts # Edit Check 엔진
│   ├── types/
│   │   └── index.ts           # 공통 타입
│   └── utils/
│       ├── crypto.ts          # 암호화 유틸
│       ├── date.ts            # 날짜 유틸
│       └── id.ts              # ID 생성
├── public/
│   ├── static/
│   │   ├── app.js             # 프론트엔드 JS (SPA)
│   │   ├── style.css          # 스타일
│   │   └── sw.js              # Service Worker
│   ├── manifest.json          # PWA 매니페스트
│   └── icons/                 # PWA 아이콘
├── migrations/
│   ├── 0001_initial_schema.sql
│   ├── 0002_edit_check_rules.sql  # Edit Check 테이블
│   ├── 0003_fix_edit_check_results_fk.sql
│   └── 0004_add_export_action.sql # Export 감사 로그 액션
├── seed.sql                   # 테스트 데이터
├── ecosystem.config.cjs       # PM2 설정
├── wrangler.jsonc             # Cloudflare 설정
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## 🛠️ 개발 환경 설정

### 필수 요구사항

- Node.js 18.x 이상
- npm 9.x 이상
- Wrangler CLI
- Git

### 로컬 개발

```bash
# 의존성 설치
npm install

# D1 마이그레이션 (로컬)
npm run db:migrate:local

# 테스트 데이터 시딩
npm run db:seed

# 빌드
npm run build

# 개발 서버 실행 (PM2)
pm2 start ecosystem.config.cjs

# 서비스 확인
curl http://localhost:3000/api/health
```

### 배포

```bash
# 프로덕션 D1 마이그레이션
npm run db:migrate:prod

# Cloudflare Pages 배포
npm run deploy
```

---

## 📝 사용 가이드

### 1. 로그인
- 테스트 계정으로 로그인 (예: admin@ecrf.local / Test1234!)

### 2. Study 조회
- 대시보드에서 임상시험 목록 확인
- Study 클릭하여 상세 정보 조회

### 3. Site 관리
- Study 상세에서 연구기관 목록 확인
- Site 클릭하여 피험자 목록 조회

### 4. Subject 등록
- Site 상세에서 "피험자 등록" 클릭
- 이니셜, 스크리닝일 입력

### 5. CRF 입력
- Subject > Visit > CRF 선택
- 필드 입력 후 자동 저장
- 완료 버튼으로 CRF 완료 처리

### 6. Query 관리
- 대시보드에서 미결 Query 확인
- Query 클릭하여 답변 입력

### 7. 전자서명
- 완료된 CRF에서 "서명" 클릭
- 비밀번호 확인 후 서명

---

## 🔒 보안 요구사항

### 인증 보안

| 항목 | 요구사항 |
|------|---------|
| 비밀번호 정책 | 최소 8자, 대소문자+숫자+특수문자 |
| 세션 타임아웃 | 30분 무활동 시 자동 로그아웃 |
| 로그인 실패 | 5회 실패 시 계정 잠금 (30분) |
| 비밀번호 변경 | 90일마다 변경 권고 |

### 데이터 암호화

| 구간 | 방식 |
|------|------|
| 전송 (Transit) | TLS 1.3 |
| 저장 (At Rest) | AES-256 |
| 비밀번호 | PBKDF2-SHA256 (100,000 iterations) |

---

## 📅 개발 로드맵

### 완료됨 ✅
- 프로젝트 초기 설정
- 사용자 인증 및 권한 관리
- Study/Site/Subject 구조
- Visit/CRF 데이터 입력
- 동적 폼 렌더링
- 데이터 검증
- Audit Trail
- Query Management
- 전자서명
- **고급 Edit Check 엔진** (Phase 2)
  - RANGE, CROSS_FIELD, REQUIRED 규칙 지원
  - Cloudflare Workers 호환 조건 평가기 (new Function() 없이)
  - 자동 Query 생성 기능
  - 결과 저장 및 이력 관리
- **Data Lock/Freeze** (Phase 2)
  - SUBJECT, VISIT, SITE, STUDY 레벨 잠금
  - Lock/Unlock 감사 추적
  - Lock 이력 및 통계
- **Data Export** (Phase 2)
  - CSV/JSON 포맷 지원
  - Subject, CRF Data (Long/Wide), Query, Audit Trail Export
  - Export 활동 감사 로깅
- **CDISC Export** (Phase 2)
  - ODM XML 포맷 (CDISC ODM 1.3.2 준수)
  - SDTM Domain Export (DM, VS, AE, CM, MH, LB, PE)
  - CSV/JSON 포맷 지원
- **리포트/대시보드 강화** (Phase 2)
  - Dashboard Overview (메트릭, 최근 활동, 알림)
  - 등록 현황 (목표 대비 진행률, 기관별 통계)
  - CRF 진행률 (Form별/Visit별 완료율)
  - Query 통계 (상태별, Aging 분석)
  - Site 성과 비교
- **오프라인 지원** (Phase 3)
  - Service Worker v2 (정적 리소스/API 캐싱)
  - IndexedDB 기반 오프라인 데이터 저장
  - 오프라인 변경사항 자동 동기화
  - 충돌 감지 및 해결 시스템
  - 동기화 대시보드 UI
  - CRF 데이터 프리페치

### 다음 단계 🔄
- 모바일 UI 최적화
- 2FA (Two-Factor Authentication)
- Push 알림 시스템
- 고급 리포트/차트

---

## 📚 참고 자료

- [21 CFR Part 11](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-11) - FDA 전자기록/전자서명 규정
- [ICH E6(R2) GCP](https://www.ich.org/page/efficacy-guidelines) - 임상시험 관리기준
- [CDISC Standards](https://www.cdisc.org/standards) - 임상 데이터 표준
- [Hono Documentation](https://hono.dev/) - Hono 프레임워크
- [Cloudflare Workers](https://developers.cloudflare.com/workers/) - 엣지 컴퓨팅

---

---

## 🔍 Edit Check 기능 가이드

### Edit Check 규칙 타입

| 타입 | 설명 | 예시 |
|------|------|------|
| **RANGE** | 값 범위 검증 | 수축기 혈압 60-200 mmHg |
| **CROSS_FIELD** | 필드 간 논리 검증 | 수축기 > 이완기 혈압 |
| **REQUIRED** | 필수 값 검증 | 필드 값이 비어있지 않음 |
| **DATE_LOGIC** | 날짜 논리 검증 | 종료일 >= 시작일 |
| **CONSISTENCY** | 일관성 검증 | 값 변경 범위 제한 |

### 규칙 생성 예시

```bash
# RANGE 규칙 생성
curl -X POST http://localhost:3000/api/edit-checks/rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "study_id": "study_001",
    "rule_code": "VS_SBP_RANGE",
    "rule_name": "수축기 혈압 범위 검사",
    "rule_type": "RANGE",
    "severity": "ERROR",
    "target_form_code": "VS",
    "target_field_code": "SYSBP",
    "rule_definition": {"field": "SYSBP", "min": 60, "max": 200, "unit": "mmHg"},
    "error_message_template": "Systolic BP ({value}) out of range",
    "error_message_ko": "수축기 혈압이 범위를 벗어났습니다"
  }'
```

### Edit Check 실행

```bash
# CRF에 대해 Edit Check 실행
curl -X POST http://localhost:3000/api/edit-checks/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "crf_instance_id": "crf_002",
    "form_data": {"SYSBP": "250", "DIABP": "80"},
    "execution_context": "MANUAL"
  }'
```

### 응답 예시

```json
{
  "message": "Edit checks executed successfully",
  "summary": {
    "totalRules": 4,
    "totalChecks": 1,
    "passed": 0,
    "errors": 1,
    "warnings": 0,
    "info": 0
  },
  "results": [
    {
      "ruleId": "rule_xxx",
      "ruleCode": "VS_SBP_RANGE",
      "passed": false,
      "severity": "ERROR",
      "message": "수축기 혈압이 범위를 벗어났습니다",
      "fieldCode": "SYSBP",
      "fieldValue": "250"
    }
  ]
}
```

---

## 🔐 Data Lock/Freeze 기능 가이드

### Lock 타입

| 타입 | 설명 |
|------|------|
| **SUBJECT** | 피험자 레벨 잠금 - 해당 Subject의 모든 데이터 수정 불가 |
| **VISIT** | 방문 레벨 잠금 - 해당 Visit의 모든 CRF 수정 불가 |
| **SITE** | 기관 레벨 잠금 - 해당 Site의 모든 Subject 수정 불가 |
| **STUDY** | 임상시험 레벨 잠금 - 전체 Study 데이터 수정 불가 |

### Lock 생성 예시

```bash
# Subject Lock (DM 역할 필요)
curl -X POST http://localhost:3000/api/locks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "lock_type": "SUBJECT",
    "record_id": "subj_001",
    "lock_reason": "데이터 검토 완료"
  }'
```

### Lock 해제 예시

```bash
# Unlock
curl -X POST http://localhost:3000/api/locks/{lock_id}/unlock \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "unlock_reason": "검토 완료, 데이터 수정 허용"
  }'
```

---

## 📤 Data Export 기능 가이드

### Export 가능 데이터

| 타입 | 설명 | 포맷 |
|------|------|------|
| **subjects** | 피험자 등록 데이터 | CSV, JSON |
| **crf-data** | CRF 데이터 (Long format) | CSV, JSON |
| **crf-wide** | CRF 데이터 (Wide format by Form) | CSV, JSON |
| **queries** | Query 데이터 | CSV, JSON |
| **audit-trail** | Audit Trail | CSV, JSON |

### Export 요약 조회

```bash
curl "http://localhost:3000/api/exports/summary?study_id=study_001" \
  -H "Authorization: Bearer $TOKEN"
```

### Subject Export

```bash
# JSON 포맷
curl "http://localhost:3000/api/exports/subjects?study_id=study_001&format=json" \
  -H "Authorization: Bearer $TOKEN"

# CSV 포맷 (파일 다운로드)
curl "http://localhost:3000/api/exports/subjects?study_id=study_001&format=csv" \
  -H "Authorization: Bearer $TOKEN" \
  -o subjects_export.csv
```

### CRF Data Export (Wide format)

```bash
# VS Form의 Wide format Export
curl "http://localhost:3000/api/exports/crf-wide?study_id=study_001&form_code=VS&format=csv" \
  -H "Authorization: Bearer $TOKEN" \
  -o vs_data.csv
```

### Export 응답 예시 (JSON)

```json
{
  "export_date": "2026-01-26T09:47:59.262Z",
  "study_id": "study_001",
  "total_records": 3,
  "data": [
    {
      "subject_number": "01-001",
      "screening_number": "SCR-001",
      "status": "ENROLLED",
      "site_number": "01",
      "site_name": "Seoul University Hospital"
    }
  ]
}
```

---

## 🌐 CDISC Export 기능 가이드

### SDTM Domain Export

| Domain | 설명 | 주요 변수 |
|--------|------|----------|
| **DM** | Demographics | USUBJID, SUBJID, RFSTDTC, SEX, RACE |
| **VS** | Vital Signs | VSTESTCD, VSORRES, VSDTC |
| **AE** | Adverse Events | AETERM, AESTDTC, AEENDTC, AESEV |
| **CM** | Concomitant Medications | CMTRT, CMDOSE, CMSTDTC |
| **MH** | Medical History | MHTERM, MHSTDTC |
| **LB** | Laboratory Tests | LBTESTCD, LBORRES, LBDTC |
| **PE** | Physical Examination | PETEST, PEORRES, PEDTC |

### SDTM Export 예시

```bash
# 지원 Domain 목록 조회
curl "http://localhost:3000/api/cdisc/domains?study_id=study_001" \
  -H "Authorization: Bearer $TOKEN"

# DM Domain Export (JSON)
curl "http://localhost:3000/api/cdisc/sdtm/dm?study_id=study_001&format=json" \
  -H "Authorization: Bearer $TOKEN"

# VS Domain Export (CSV)
curl "http://localhost:3000/api/cdisc/sdtm/vs?study_id=study_001&format=csv" \
  -H "Authorization: Bearer $TOKEN" \
  -o vs_sdtm.csv
```

### ODM XML Export

```bash
# ODM XML 전체 Export
curl "http://localhost:3000/api/cdisc/odm?study_id=study_001" \
  -H "Authorization: Bearer $TOKEN" \
  -o study_data.xml
```

---

## 📊 리포트/대시보드 API 가이드

### Dashboard Overview

```bash
curl "http://localhost:3000/api/reports/dashboard?study_id=study_001" \
  -H "Authorization: Bearer $TOKEN"
```

**응답 예시:**
```json
{
  "study": { "id": "study_001", "title": "..." },
  "metrics": {
    "total_sites": 3,
    "active_sites": 2,
    "total_subjects": 15,
    "enrolled_subjects": 10,
    "crf_completion_rate": 75.5,
    "open_queries": 5
  },
  "recent_activity": [...],
  "alerts": [
    { "type": "info", "message": "등록 진행률이 45%입니다." }
  ]
}
```

### Enrollment Summary

```bash
curl "http://localhost:3000/api/reports/enrollment/summary?study_id=study_001" \
  -H "Authorization: Bearer $TOKEN"
```

### CRF Progress

```bash
# Form별 진행률
curl "http://localhost:3000/api/reports/crf/progress?study_id=study_001" \
  -H "Authorization: Bearer $TOKEN"

# Missing CRF 리포트
curl "http://localhost:3000/api/reports/crf/missing?study_id=study_001" \
  -H "Authorization: Bearer $TOKEN"
```

### Query Statistics

```bash
# Query 통계
curl "http://localhost:3000/api/reports/queries/stats?study_id=study_001" \
  -H "Authorization: Bearer $TOKEN"

# Query Aging 분석
curl "http://localhost:3000/api/reports/queries/aging?study_id=study_001" \
  -H "Authorization: Bearer $TOKEN"
```

### Site Performance

```bash
curl "http://localhost:3000/api/reports/sites/performance?study_id=study_001" \
  -H "Authorization: Bearer $TOKEN"
```

---

## 📱 오프라인 지원 기능 가이드

### 오프라인 기능 개요

eCRF PWA는 Service Worker와 IndexedDB를 활용하여 오프라인 환경에서도 CRF 데이터 입력 및 조회가 가능합니다.

### 지원 기능

| 기능 | 오프라인 지원 | 설명 |
|------|:------------:|------|
| CRF 데이터 조회 | ✅ | 캐시된 데이터 조회 |
| CRF 데이터 입력 | ✅ | 로컬 저장 후 동기화 |
| Query 조회 | ✅ | 캐시된 데이터 조회 |
| Query 답변 | ✅ | 로컬 저장 후 동기화 |
| 전자서명 | ⚠️ | 로컬 저장 (온라인 시 서버 검증) |
| Export | ❌ | 온라인 필요 |

### 오프라인 인디케이터

- 화면 좌측 하단에 오프라인 상태 표시
- 대기중인 변경사항 수 Badge 표시
- 클릭 시 동기화 대시보드 열림

### 동기화 대시보드

동기화 대시보드에서 확인/관리 가능:

1. **연결 상태**: 온라인/오프라인 상태
2. **대기중 변경사항**: 동기화 대기 중인 데이터 수
3. **충돌 항목**: 서버와 충돌된 데이터
4. **실패 항목**: 동기화 실패한 데이터
5. **캐시 통계**: 저장된 캐시 크기/항목 수
6. **동기화 이력**: 최근 동기화 로그

### 충돌 해결

오프라인에서 수정한 데이터가 서버에서도 변경된 경우:

1. **로컬 데이터 사용**: 내 변경사항으로 서버 덮어쓰기
2. **서버 데이터 사용**: 서버 데이터로 로컬 변경 취소

### 오프라인 데이터 다운로드

오프라인 작업을 위해 사전에 데이터 다운로드:

1. 동기화 대시보드 열기 (오프라인 인디케이터 클릭)
2. "오프라인 데이터 다운로드" 버튼 클릭
3. Study/Site/Subject/Visit/Form 정의 등 필요 데이터 캐시

### 캐시 정리

주기적으로 만료된 캐시 자동 정리 (1시간 간격)
수동 정리: 동기화 대시보드 > "캐시 정리" 버튼

---

*최종 업데이트: 2026-01-26*
