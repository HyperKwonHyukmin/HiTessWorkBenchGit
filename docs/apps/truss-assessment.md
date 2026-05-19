# Truss Structural Assessment — 입출력 계약

## 기본 정보

| 항목 | 값 |
|------|-----|
| 앱 이름 | Truss Structural Assessment |
| 메뉴 라벨 | `'Truss Structural Assessment'` |
| devStatus | `stable` |
| 카테고리 | `file-based` |
| 기여자 | Kwon Hyuk min |

---

## 입력

| 항목 | 필수 | 형식 | 설명 |
|------|------|------|------|
| BDF 파일 | ✓ | `.bdf` | NASTRAN Bulk Data File (트러스 모델) |
| 하중 케이스 선택 | | UI 체크박스 | BDF 내 정의된 Load Case 중 선택 |

**BDF 최소 요구 카드**: `GRID`, `CROD`/`CTUBE`/`CBAR`, `PROD`/`PTUBE`/`PBAR`, `MAT1`, `FORCE`/`MOMENT`, `SPC`, `SUBCASE`

---

## 실행 exe

| 항목 | 값 |
|------|-----|
| 경로 | `InHouseProgram/TrussAssessment/TrussAssessment.exe` |
| 실행 방식 | `subprocess.Popen([EXE, bdf_path, out_dir])` |
| 서비스 파일 | `app/services/assessment_service.py` |
| 비동기 방식 | ThreadPoolExecutor (job_manager.py), 1.5초 폴링 |

---

## 결과 파일

| 파일명 패턴 | 형식 | 설명 |
|-------------|------|------|
| `assessment_result.json` | JSON | 부재 평가 결과 (loadCases 배열) |
| `*.xlsx` (메모리 생성) | Excel | `assessment_service._json_to_xlsx_bytes()` 로 즉시 변환, 디스크 저장 안 함 |

---

## result_info JSON 스키마

```typescript
{
  input_files:  string[];    // ["userConnection/.../input.bdf"]
  result_files: string[];    // ["userConnection/.../assessment_result.json"]
  summary: {
    totalElements:   number;   // 전체 부재 수
    passCount:       number;   // PASS 부재 수
    failCount:       number;   // FAIL 부재 수
    maxAssessment:   number;   // 최대 평가율
    loadCaseCount:   number;   // 하중 케이스 수
  };
}
```

### assessment_result.json 내부 구조

```typescript
{
  loadCases: Array<{
    id:      number;
    name:    string;
    members: Array<{
      element:       number;
      set:           string;
      property:      string;
      axial:         number;
      bending:       number;
      allowAxial:    number;
      allowBending:  number;
      assessment:    number;  // 최대 평가율 (0~1+)
      result:        "PASS" | "FAIL";
    }>;
    distributionPanels?: Array<{...}>;  // 하중분산판 (옵션)
    sideSupports?:       Array<{...}>;  // 측면 지지 (옵션)
  }>;
}
```

---

## My Projects 재열람

**만료(30일) 전:**
- 부재별 평가율 상세 (AssessmentResultViewerModal)
- 하중 케이스별 필터
- FAIL 부재 강조 표시
- Excel 내보내기 (메모리 변환, DRM 우회)
- BDF 원본 다운로드

**만료(30일) 후:**
- DB의 `summary` (총 부재 수, PASS/FAIL 카운트, 최대 평가율) 조회 가능
- 파일 다운로드 불가 (FileRetentionBadge 회색)

---

## Excel 내보내기 특이사항

`GET /api/analysis/export-xlsx?filepath=...` → `_json_to_xlsx_bytes()`:

- **디스크에 저장하지 않음** → 회사 DRM 소프트웨어 자동 암호화 우회
- `BytesIO` 메모리 내 openpyxl 변환 후 `StreamingResponse`로 반환
- 시트 구성: Load Case별 1개 시트 (SUMMARY + ELEMENT ASSESSMENT + 선택 섹션)
- 스타일: 네이비 헤더(`#002554`), FAIL 행 빨강 강조

---

## 오류 유형

| 오류 종류 | 예시 메시지 | 원인 | 대응 |
|-----------|-------------|------|------|
| 입력 오류 | `BDF 파싱 실패: GRID 카드 없음` | 필수 카드 누락 | BDF 검토 (BDF Scanner 활용) |
| 런타임 오류 | `TrussAssessment.exe exit code 1` | 해석 내부 오류 | 로그 파일 확인 |
| 타임아웃 | `Job timeout` | 대형 모델 | 모델 경량화 또는 하중 케이스 분리 |
| 결과 없음 | `assessment_result.json not found` | exe 미정상 종료 | 서버 로그 확인 |

---

## 관련 코드

- 서비스: `app/services/assessment_service.py`
- xlsx 변환: `assessment_service._json_to_xlsx_bytes()`
- 라우터: `app/routers/analysis.py` (`/api/analysis/assessment/request`)
- 페이지: `pages/analysis/TrussAssessment.jsx`
- 결과 뷰어: `components/modals/AssessmentResultViewerModal.jsx`
- exe: `InHouseProgram/TrussAssessment/`
