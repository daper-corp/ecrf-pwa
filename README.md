# eCRF PWA (Electronic Case Report Form - Progressive Web Application)

## 프로젝트 개요

- **프로젝트명**: eCRF PWA
- **목적**: 임상시험에서 환자 데이터를 전자적으로 수집, 관리하는 PWA 시스템
- **핵심 원칙**: 데이터 정확성(Integrity)과 추적 가능성(Traceability)
- **기술 스택**: Hono + TypeScript + Cloudflare Pages + D1 Database
- **규제 준수**: 21 CFR Part 11, CDISC 표준 지원 목표

## 현재 개발 상태

### Phase 1: 기본 MVP (현재 진행 중)

| 기능 | 상태 | 설명 |
|------|------|------|
| 프로젝트 초기 설정 | ✅ 완료 | Hono + Cloudflare Pages 환경 구성 |
| 사용자 인증 시스템 | 🔄 진행중 | 역할 기반 접근 제어 (RBAC) |
| Study/Site/Subject 구조 | 🔄 진행중 | 계층적 데이터 관리 |
| 동적 CRF 폼 시스템 | ⏳ 대기중 | Visit별 데이터 수집 |
| 기본 데이터 검증 | ⏳ 대기중 | 필수/범위/논리 검증 |
| Audit Trail | 🔄 진행중 | 21 CFR Part 11 준수 |

### Phase 2: 실사용 필수 기능 (예정)

| 기능 | 상태 | 설명 |
|------|------|------|
| Query Management | ⏳ 대기중 | 데이터 질의 시스템 |
| 전자서명 시스템 | ⏳ 대기중 | 법적 효력 있는 서명 |
| 고급 Edit Check | ⏳ 대기중 | 복합 검증 규칙 엔진 |
| Data Lock/Freeze | ⏳ 대기중 | 단계적 데이터 고정 |

### Phase 3: PWA 특화 기능 (예정)

| 기능 | 상태 | 설명 |
|------|------|------|
| 오프라인 지원 | ⏳ 대기중 | Service Worker + IndexedDB |
| 동기화 시스템 | ⏳ 대기중 | 충돌 해결 메커니즘 |
| 모바일 최적화 | ⏳ 대기중 | 터치 인터페이스 최적화 |
| 보안 강화 | ⏳ 대기중 | 다층 암호화 체계 |

---

## 사용자 역할 및 권한

### 역할 정의

| 역할 | 코드 | 주요 권한 |
|------|------|----------|
| **PI (책임연구자)** | `PI` | 모든 데이터 조회, 최종 승인, 전자서명 |
| **Sub-Investigator (공동연구자)** | `SUB_INV` | 데이터 입력/조회, 부분 승인 |
| **CRC (연구간호사)** | `CRC` | 일상적 데이터 입력/수정 |
| **CRA (모니터)** | `CRA` | 데이터 조회, Query 발행 (수정 불가) |
| **Data Manager** | `DM` | 전체 데이터 관리, Export, Lock/Unlock |
| **System Admin** | `ADMIN` | 시스템 설정, 사용자 관리 |

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

## 데이터 아키텍처

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

### 핵심 데이터 모델

#### 1. Study (임상시험)
```sql
studies (
    id                  TEXT PRIMARY KEY,
    protocol_number     TEXT UNIQUE NOT NULL,
    title               TEXT NOT NULL,
    version             TEXT NOT NULL,
    status              TEXT CHECK(status IN ('DRAFT','ACTIVE','COMPLETED','LOCKED')),
    irb_approval_number TEXT,
    irb_approval_date   TEXT,
    irb_expiry_date     TEXT,
    created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at          TEXT DEFAULT CURRENT_TIMESTAMP
)
```

#### 2. Site (연구 기관)
```sql
sites (
    id              TEXT PRIMARY KEY,
    study_id        TEXT REFERENCES studies(id),
    site_number     TEXT NOT NULL,
    name            TEXT NOT NULL,
    address         TEXT,
    pi_name         TEXT,
    pi_email        TEXT,
    status          TEXT CHECK(status IN ('PENDING','ACTIVE','CLOSED')),
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP
)
```

#### 3. Subject (피험자)
```sql
subjects (
    id                      TEXT PRIMARY KEY,
    site_id                 TEXT REFERENCES sites(id),
    subject_number          TEXT NOT NULL,
    screening_number        TEXT,
    randomization_number    TEXT,
    status                  TEXT CHECK(status IN ('SCREENING','ENROLLED','COMPLETED','WITHDRAWN')),
    enrolled_date           TEXT,
    withdrawn_date          TEXT,
    withdrawal_reason       TEXT,
    created_at              TEXT DEFAULT CURRENT_TIMESTAMP
)
```

#### 4. Visit (방문)
```sql
visits (
    id              TEXT PRIMARY KEY,
    subject_id      TEXT REFERENCES subjects(id),
    visit_name      TEXT NOT NULL,
    visit_number    INTEGER NOT NULL,
    scheduled_date  TEXT,
    actual_date     TEXT,
    status          TEXT CHECK(status IN ('SCHEDULED','IN_PROGRESS','COMPLETED','MISSED')),
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP
)
```

#### 5. CRF Form Data (CRF 양식 데이터)
```sql
crf_data (
    id              TEXT PRIMARY KEY,
    visit_id        TEXT REFERENCES visits(id),
    form_type       TEXT NOT NULL,
    field_name      TEXT NOT NULL,
    field_value     TEXT,
    status          TEXT CHECK(status IN ('DRAFT','COMPLETE','SIGNED','LOCKED')),
    signed_by       TEXT REFERENCES users(id),
    signed_at       TEXT,
    locked_at       TEXT,
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
)
```

#### 6. Audit Trail (감사 추적)
```sql
audit_logs (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    user_name           TEXT NOT NULL,
    user_role           TEXT NOT NULL,
    timestamp           TEXT NOT NULL,
    action              TEXT NOT NULL,
    table_name          TEXT NOT NULL,
    record_id           TEXT NOT NULL,
    field_name          TEXT,
    old_value           TEXT,
    new_value           TEXT,
    reason_for_change   TEXT,
    ip_address          TEXT,
    session_id          TEXT
)
```

#### 7. Query (데이터 질의)
```sql
queries (
    id              TEXT PRIMARY KEY,
    crf_data_id     TEXT REFERENCES crf_data(id),
    status          TEXT CHECK(status IN ('OPEN','ANSWERED','CLOSED','CANCELLED')),
    priority        TEXT CHECK(priority IN ('CRITICAL','MAJOR','MINOR')),
    query_text      TEXT NOT NULL,
    answer_text     TEXT,
    created_by      TEXT REFERENCES users(id),
    answered_by     TEXT REFERENCES users(id),
    closed_by       TEXT REFERENCES users(id),
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    answered_at     TEXT,
    closed_at       TEXT
)
```

### 저장 서비스

| 데이터 유형 | 저장소 | 설명 |
|------------|--------|------|
| 관계형 데이터 | **Cloudflare D1** | 모든 핵심 비즈니스 데이터 |
| 세션/캐시 | **Cloudflare KV** | 로그인 세션, 임시 데이터 |
| 첨부파일 | **Cloudflare R2** | PDF, 이미지 등 첨부 문서 |
| 오프라인 데이터 | **IndexedDB** | PWA 로컬 저장 |

---

## API 엔드포인트

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
| POST | `/api/visits/:id/crf` | CRF 데이터 저장 |
| POST | `/api/visits/:id/sign` | CRF 서명 |
| POST | `/api/visits/:id/lock` | CRF Lock |

### Query API
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/queries` | Query 목록 (필터 지원) |
| POST | `/api/queries` | Query 생성 |
| POST | `/api/queries/:id/answer` | Query 답변 |
| POST | `/api/queries/:id/close` | Query 종료 |

### Audit API
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/audit/logs` | 감사 로그 조회 |
| GET | `/api/audit/logs/:recordId` | 특정 레코드 변경 이력 |

---

## CRF 폼 유형

### Visit별 기본 CRF 구성

| Visit | 수집 양식 |
|-------|----------|
| **Screening** | Informed Consent, Demographics, Medical History, Inclusion/Exclusion Criteria |
| **Baseline** | Vital Signs, Physical Exam, Lab Tests, Concomitant Medications |
| **Treatment Visits** | Vital Signs, Adverse Events, Study Drug Administration, Lab Tests |
| **Follow-up** | Vital Signs, Adverse Events, End of Study Form |
| **Unscheduled** | Adverse Events, Concomitant Medications |

### CRF 필드 타입

| 타입 | 설명 | 예시 |
|------|------|------|
| `TEXT` | 단순 텍스트 | 이름, 주소 |
| `NUMBER` | 숫자 (범위 검증) | 나이, 혈압 |
| `DATE` | 날짜 | 생년월일, 방문일 |
| `DATETIME` | 날짜+시간 | 투약 시간 |
| `SELECT` | 단일 선택 | 성별, 인종 |
| `MULTI_SELECT` | 다중 선택 | 증상, 병력 |
| `RADIO` | 라디오 버튼 | Yes/No 질문 |
| `CHECKBOX` | 체크박스 | 동의 항목 |
| `TEXTAREA` | 긴 텍스트 | 비고, 상세 설명 |
| `CALCULATED` | 자동 계산 | BMI, 용량 |

---

## 데이터 검증 규칙

### 검증 유형

| 레벨 | 색상 | 동작 |
|------|------|------|
| **Error** | 🔴 빨강 | 저장 불가, 반드시 수정 필요 |
| **Warning** | 🟡 노랑 | 저장 가능, Query 대상 |
| **Info** | 🔵 파랑 | 정보 제공, 저장 무관 |

### 기본 검증 규칙

```typescript
// 검증 규칙 예시
const validationRules = {
  // 필수 필드
  required: {
    severity: 'error',
    message: '필수 입력 항목입니다.'
  },
  
  // 범위 검증
  vitalSigns: {
    systolic_bp: { min: 80, max: 200, unit: 'mmHg' },
    diastolic_bp: { min: 40, max: 120, unit: 'mmHg' },
    heart_rate: { min: 40, max: 200, unit: 'bpm' },
    body_temp: { min: 35.0, max: 42.0, unit: '°C' },
    weight: { min: 30, max: 300, unit: 'kg' },
    height: { min: 100, max: 250, unit: 'cm' }
  },
  
  // 논리 검증
  crossField: [
    {
      rule: 'systolic_bp > diastolic_bp',
      message: '수축기 혈압이 이완기 혈압보다 높아야 합니다.',
      severity: 'error'
    },
    {
      rule: 'gender === "FEMALE" && pregnant !== null',
      message: '여성의 경우 임신 여부를 입력해야 합니다.',
      severity: 'error'
    }
  ],
  
  // 날짜 검증
  dateLogic: [
    {
      rule: 'endDate >= startDate',
      message: '종료일은 시작일 이후여야 합니다.',
      severity: 'error'
    },
    {
      rule: 'aeOnsetDate >= firstDoseDate',
      message: '이상반응 발생일이 첫 투약일보다 빠릅니다.',
      severity: 'warning'
    }
  ]
};
```

---

## 보안 요구사항

### 인증 보안

| 항목 | 요구사항 |
|------|---------|
| 비밀번호 정책 | 최소 8자, 대소문자+숫자+특수문자 |
| 세션 타임아웃 | 15~30분 무활동 시 자동 로그아웃 |
| 로그인 실패 | 5회 실패 시 계정 잠금 (30분) |
| 비밀번호 변경 | 90일마다 변경 권고 |
| 이전 비밀번호 | 최근 5개 재사용 금지 |

### 데이터 암호화

| 구간 | 방식 |
|------|------|
| 전송 (Transit) | TLS 1.3 |
| 저장 (At Rest) | AES-256 |
| 로컬 저장 | Web Crypto API |
| 비밀번호 | bcrypt (cost factor 12) |

### 접근 제어

- IP 화이트리스트 (선택적)
- 다중 기관 간 데이터 격리
- 역할 기반 접근 제어 (RBAC)
- 행위 기반 권한 검증

---

## PWA 기능 (Phase 3)

### Service Worker 전략

```javascript
const CACHE_STRATEGY = {
  'app-shell': 'cache-first',        // HTML, CSS, JS
  'study-metadata': 'network-first', // Study 구조, 폼 정의
  'subject-data': 'network-only',    // 환자 데이터 (보안)
  'static-assets': 'cache-first'     // 이미지, 폰트
};
```

### 오프라인 데이터 구조

```javascript
// IndexedDB 저장 구조
const offlineData = {
  studyId: 'STUDY001',
  siteId: 'SITE01',
  subjectId: 'SUBJ001',
  visitId: 'VISIT_WEEK4',
  formData: {
    vital_signs: {
      systolic_bp: 120,
      diastolic_bp: 80,
      modified_at: '2024-01-15T10:30:00Z',
      sync_status: 'pending'  // pending | synced | conflict
    }
  },
  localChanges: [
    {
      timestamp: '2024-01-15T10:30:00Z',
      field: 'systolic_bp',
      oldValue: null,
      newValue: 120
    }
  ]
};
```

### 동기화 충돌 해결

| 전략 | 설명 | 사용 시점 |
|------|------|----------|
| Server Wins | 서버 데이터 우선 | 기본값, 안전한 선택 |
| Last Write Wins | 최신 타임스탬프 우선 | 단일 사용자 환경 |
| User Decision | 사용자가 선택 | 충돌 명시적 해결 필요 시 |

---

## 개발 환경 설정

### 필수 요구사항

- Node.js 18.x 이상
- npm 9.x 이상
- Wrangler CLI
- Git

### 로컬 개발

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# D1 마이그레이션 (로컬)
npm run db:migrate:local

# 테스트 데이터 시딩
npm run db:seed

# 빌드
npm run build

# 프리뷰 (Wrangler)
npm run preview
```

### 배포

```bash
# 프로덕션 D1 마이그레이션
npm run db:migrate:prod

# Cloudflare Pages 배포
npm run deploy
```

---

## 프로젝트 구조

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
│   │   └── audit.ts           # Audit API
│   ├── middleware/
│   │   ├── auth.ts            # 인증 미들웨어
│   │   ├── rbac.ts            # 권한 검증
│   │   └── audit.ts           # 감사 로깅
│   ├── services/
│   │   ├── auth.service.ts    # 인증 서비스
│   │   ├── audit.service.ts   # 감사 서비스
│   │   └── validation.service.ts # 검증 서비스
│   ├── types/
│   │   ├── index.ts           # 공통 타입
│   │   ├── study.ts           # Study 타입
│   │   ├── crf.ts             # CRF 타입
│   │   └── user.ts            # User 타입
│   └── utils/
│       ├── crypto.ts          # 암호화 유틸
│       ├── date.ts            # 날짜 유틸
│       └── id.ts              # ID 생성
├── public/
│   ├── static/
│   │   ├── app.js             # 프론트엔드 JS
│   │   ├── style.css          # 스타일
│   │   └── sw.js              # Service Worker
│   ├── manifest.json          # PWA 매니페스트
│   └── icons/                 # PWA 아이콘
├── migrations/
│   ├── 0001_initial_schema.sql
│   └── 0002_seed_data.sql
├── wrangler.jsonc
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## 주요 URL

| 환경 | URL |
|------|-----|
| 로컬 개발 | http://localhost:3000 |
| 프로덕션 | https://ecrf-pwa.pages.dev (예정) |
| GitHub | (설정 필요) |

---

## 개발 로드맵

### 1단계: 기본 MVP (3-4개월)
- [x] 프로젝트 초기 설정
- [ ] 사용자 인증 및 기본 권한 관리
- [ ] Study/Site/Subject 기본 구조
- [ ] 단순한 CRF 폼 입력 및 저장
- [ ] 기본 Audit Trail 구현

### 2단계: 실사용 준비 (3-4개월)
- [ ] Query Management 시스템
- [ ] 전자서명 기능
- [ ] 고급 데이터 검증 규칙
- [ ] 기본 Export 기능

### 3단계: PWA 고도화 (4-6개월)
- [ ] 완전한 오프라인 지원
- [ ] 동기화 및 충돌 해결
- [ ] 모바일 최적화
- [ ] 성능 최적화

### 4단계: 고급 기능 (지속적)
- [ ] CDISC SDTM 표준 지원
- [ ] 고급 리포팅 및 대시보드
- [ ] 외부 시스템 연동 (CTMS, IWRS)
- [ ] 규제 대응 완성

---

## 핵심 개발 원칙

### 1. 데이터 무결성 최우선
> "데이터가 절대 사라지거나 조작되지 않았음"을 증명할 수 있어야 합니다.

### 2. 규제 우선 설계
> 21 CFR Part 11, CDISC 표준 요구사항을 처음부터 설계에 반영합니다.

### 3. 사용자 중심 접근
> 화려한 UI보다 데이터 입력의 효율성과 정확성에 집중합니다.

### 4. 점진적 확장
> 작은 범위의 파일럿으로 시작하여 점진적으로 기능을 확장합니다.

---

## 참고 자료

- [21 CFR Part 11](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-11) - FDA 전자기록/전자서명 규정
- [ICH E6(R2) GCP](https://www.ich.org/page/efficacy-guidelines) - 임상시험 관리기준
- [CDISC Standards](https://www.cdisc.org/standards) - 임상 데이터 표준
- [Hono Documentation](https://hono.dev/) - Hono 프레임워크
- [Cloudflare Workers](https://developers.cloudflare.com/workers/) - 엣지 컴퓨팅

---

## 기여 및 문의

본 프로젝트는 임상시험 데이터 관리의 디지털 전환을 목표로 합니다.
기능 제안, 버그 리포트, 코드 기여를 환영합니다.

---

*최종 업데이트: 2025-01-26*
