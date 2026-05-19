# 프론트엔드 리팩토링 후보

> 현재 PR에서는 코드 변경 없음. 향후 별도 PR 단위로 분할 진행합니다.

## 대상 파일

| 파일 | 라인 수 (약) | 주요 분리 후보 |
|------|-------------|---------------|
| `pages/analysis/MyProjects.jsx` | 700+ | ProjectDetailModal, FileRetentionBadge, 통계 hook, 필터 hook |
| `pages/dashboard/Dashboard.jsx` | 800+ | EngineeringStatCard, AppRoadmapBanner, RoadmapModal, MODE_BADGE |
| `pages/analysis/HiTessModelFlow.jsx` | 大 | 파일 업로드 step / preview / submit 분리 |
| `pages/Administration/UserManagement.jsx` | 800+ | PendingUserCard, ConfirmDeleteModal (EditModal·ActivityModal·통계 모달 분리 완료) |

---

## 공통 Hook 후보

### useAnalysisJob(jobId)

```js
// 현재: 각 페이지(TrussAnalysis, BdfScanner, SimpleBeam 등)마다 중복
const [status, setStatus] = useState(null);
useEffect(() => {
    if (!jobId) return;
    const id = setInterval(async () => {
        const data = await getJobStatus(jobId);
        setStatus(data);
        if (data.status === 'completed' || data.status === 'failed') clearInterval(id);
    }, 1500);
    return () => clearInterval(id);
}, [jobId]);
```

**추출 후:**

```js
const { status, progress, message } = useAnalysisJob(jobId);
```

- 1.5초 폴링, 완료/실패 시 자동 중지
- 완료 시 메타데이터 fetch 옵션
- 진행률 0-100 정규화

### useDistributionStats(users, keys)

```js
// UserManagement 의 부서/권한 분포 계산 → 재사용 가능
const deptStats  = useDistributionStats(users, ['department']);
const roleStats  = useDistributionStats(users, ['is_admin', 'is_active']);
```

- 카테고리별 count + percentage 반환
- UserStatisticsModal과 UserManagement 동시 활용

### useExportXlsx(jsonPath)

```js
// 현재: TrussAssessment.jsx 에만 있음
const { download, isLoading } = useExportXlsx(resultJsonPath);
```

- `GET /api/analysis/export-xlsx?filepath=...` 래퍼
- 다른 해석 앱에서도 Excel 내보내기 기능 추가 시 재사용

---

## 분리 우선순위

| 우선순위 | 대상 | 이유 |
|----------|------|------|
| High | `useAnalysisJob` hook | 페이지 5개 이상에서 중복, 버그 시 일괄 수정 어려움 |
| High | `MyProjects.jsx` 분리 | 700줄, 유지보수 어려움, FileRetentionBadge 재사용 필요 |
| Medium | `Dashboard.jsx` 분리 | RoadmapModal 독립 사용 가능성 |
| Low | `useDistributionStats` | 현재 사용처 2곳, 분리 효익 낮음 |

---

## 분리 원칙

- 300줄 이상 컴포넌트는 logical 단위로 분리
- 모달은 항상 별도 파일 (`components/modals/`)
- hook은 `hooks/` 폴더, 재사용 2곳 이상일 때만 추출
- 분리 후 기존 동작 100% 유지 (기능 추가 없음)
