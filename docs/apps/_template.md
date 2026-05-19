# [앱 이름] — 입출력 계약

> 이 파일은 신규 앱 문서화 템플릿입니다. `[...]` 부분을 채워 사용하세요.

---

## 기본 정보

| 항목 | 값 |
|------|-----|
| 앱 이름 | `[앱 정식 이름]` |
| 메뉴 라벨 | `'[App.jsx renderPage() switch 케이스]'` |
| devStatus | `[development / beta / stable]` |
| 카테고리 | `[file-based / interactive / parametric / productivity]` |
| 기여자 | `[이름]` |

---

## 입력

| 항목 | 필수 | 형식 | 설명 |
|------|------|------|------|
| `[input_field_1]` | ✓ | `.csv` / `.bdf` / etc | [설명] |
| `[input_field_2]` | | `string` / `number` | [설명] |

**입력 파일 예시:**

```
[파일 예시 또는 헤더 행]
```

---

## 실행 exe

| 항목 | 값 |
|------|-----|
| 경로 | `InHouseProgram/[폴더명]/[Exe명].exe` |
| 실행 방식 | `subprocess.run([EXE, arg1, arg2], ...)` |
| 서비스 파일 | `app/services/[service_name]_service.py` |
| 타임아웃 | `[초]s` (기본값) |

---

## 결과 파일

| 파일명 패턴 | 형식 | 설명 |
|-------------|------|------|
| `[결과파일.xlsx]` | Excel | [설명] |
| `[결과파일.json]` | JSON | [설명] |

---

## result_info JSON 스키마

DB `Analysis.result_info` 컬럼에 저장되는 JSON 구조:

```typescript
{
  input_files:  string[];    // userConnection/{dir}/input/ 경로 목록
  result_files: string[];    // userConnection/{dir}/result/ 경로 목록
  summary: {
    [key: string]: number | string;  // 대표 수치 결과
  };
  // 앱별 추가 필드
}
```

---

## My Projects 재열람

만료(30일) 전:
- [열람 가능 항목 나열]
- 파일 다운로드 가능

만료(30일) 후:
- [DB에서 조회 가능한 요약 정보]
- 파일 다운로드 불가 (FileRetentionBadge 회색)

---

## 오류 유형

| 오류 종류 | 예시 메시지 | 원인 | 대응 |
|-----------|-------------|------|------|
| 입력 오류 | `[오류 예시]` | 파일 형식/헤더 불일치 | 사용자 재업로드 |
| 런타임 오류 | `[오류 예시]` | exe 내부 계산 실패 | 로그 확인 |
| 타임아웃 | `Job timeout after Xs` | 대형 모델 | 입력 경량화 |

---

## 관련 코드

- 서비스: `app/services/[service]_service.py`
- 라우터: `app/routers/analysis.py` (공통)
- 페이지: `pages/analysis/[PageName].jsx`
- exe: `InHouseProgram/[폴더]/`
