# Column Buckling Load Calculator — 입출력 계약

## 기본 정보

| 항목 | 값 |
|------|-----|
| 앱 이름 | Column Buckling Load Calculator |
| 메뉴 라벨 | `'Column Buckling Load Calculator'` |
| devStatus | `stable` |
| 카테고리 | `parametric` |
| 기여자 | Kwon Hyuk min |

---

## 입력

| 항목 | 필수 | 형식 | 설명 |
|------|------|------|------|
| `memberName` | ✓ | `string` | 파이프/형강 단면 코드 (e.g. `"PIPE-168.3X7.1"`) |
| `columnLengthMm` | ✓ | `number (int)` | 기둥 유효 길이 (mm) |
| `employeeId` | ✓ | `string` | 작업 폴더 명명에 사용 |

**편심량**: exe 내부에서 **20mm 고정** 적용 (사용자 입력 불가).

**단면 목록**: `InHouseProgram/ColumnBucklingApp/PropertyRefer.txt` 참조.
exe는 `cwd=PropertyRefer.txt 위치`로 실행되어야 합니다.

---

## 실행 exe

| 항목 | 값 |
|------|-----|
| 경로 | `InHouseProgram/ColumnBucklingApp/ColumnBucklingApp.exe` |
| 실행 방식 | `subprocess.run([EXE, input_path, output_path], cwd=_EXE_DIR, timeout=30)` |
| 서비스 파일 | `app/services/column_buckling_service.py` |
| 실행 방식 | 동기 (HTTP 요청-응답 내에서 즉시 완료) |
| 인코딩 | `cp949` (Windows 한국어 exe) |

---

## I/O 파일

### input.json

```json
{
  "memberName":      "PIPE-168.3X7.1",
  "columnLengthMm":  3000
}
```

### output.json (ColumnBucklingApp.exe 출력)

```typescript
{
  memberName:       string;
  columnLengthMm:   number;
  area_cm2:         number;
  iy_cm:            number;    // 회전 반지름
  slendernessRatio: number;    // 세장비 λ
  fa_tf_cm2:        number;    // 허용 압축 응력 (tf/cm²)
  allowableLoad_tf: number;    // 허용 하중 (tf)
  allowableLoad_kN: number;    // 허용 하중 (kN)
  eccentricity_mm:  number;    // 편심량 (고정값 20mm)
  standard:         string;    // "AISC ASD 9th"
}
```

---

## result_info JSON 스키마

DB `Analysis.result_info` 컬럼:

```typescript
{
  input_files:  string[];    // ["userConnection/.../input.json"]
  result_files: string[];    // ["userConnection/.../output.json"]
  summary: {
    memberName:       string;
    columnLengthMm:   number;
    allowableLoad_tf: number;
    allowableLoad_kN: number;
    slendernessRatio: number;
  };
}
```

---

## My Projects 재열람

**만료(30일) 전:**
- 입력 파라미터 (단면명, 길이)
- 허용 하중 결과 (tf / kN)
- 세장비, 허용 응력 전체 결과
- `input.json`, `output.json` 다운로드

**만료(30일) 후:**
- DB의 `summary` (단면명, 길이, 허용 하중 tf/kN, 세장비) 조회 가능
- 파일 다운로드 불가

---

## 오류 유형

| 오류 종류 | 예시 메시지 | 원인 | 대응 |
|-----------|-------------|------|------|
| exe 미존재 | `503 계산 엔진을 찾을 수 없습니다` | exe 파일 누락 | `InHouseProgram/ColumnBucklingApp/` 배포 확인 |
| 단면명 오류 | exe exit code 1 + output.json 없음 | `PropertyRefer.txt`에 없는 단면 | 단면 코드 확인 |
| 타임아웃 | `500 계산 시간이 초과되었습니다` | 30초 초과 (비정상) | exe 로그 / 프로세스 확인 |
| 출력 파일 없음 | `500 계산 결과 파일이 생성되지 않았습니다` | exe 비정상 종료 | stderr/stdout 로그 확인 |

---

## 관련 코드

- 서비스: `app/services/column_buckling_service.py`
- 라우터: `app/routers/column_buckling.py`
- 페이지: `pages/analysis/ColumnBucklingCalculator.jsx`
- exe: `InHouseProgram/ColumnBucklingApp/`
- 단면 DB: `InHouseProgram/ColumnBucklingApp/PropertyRefer.txt`
