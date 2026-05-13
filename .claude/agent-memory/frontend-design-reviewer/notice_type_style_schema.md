---
name: NOTICE_TYPE_STYLE 스키마
description: Dashboard.jsx의 NOTICE_TYPE_STYLE 객체 — 공지 타입별 색상 토큰과 각 키의 사용처
type: project
---

## 파일 위치 (2026-05-08 확인)
`HiTessWorkBench/frontend/src/components/modals/NoticeDetailModal.jsx` — Dashboard.jsx가 아닌 이 파일에서 export됨. NoticeStrip과 NoticeDetailModal이 공용으로 import하는 단일 소스.

## 키 목록 및 사용처
| 키 | 사용처 |
|----|--------|
| `label` | 타입 표시 텍스트 (한국어) |
| `bar` | NoticeStrip 좌측 그라데이션 바 (`bg-gradient-to-b`) |
| `chip` | NoticeStrip 타입 배지 배경/텍스트/테두리 |
| `glow` | NoticeStrip 우측 글로우 (rgba 문자열 → inline style) |
| `headerBg` | NoticeDetailModal 헤더 그라데이션 배경 (`bg-gradient-to-br`) |
| `headerBorder` | NoticeDetailModal 본문 inset 카드 좌측 accent 라인 (`border-l-2`) |
| `chipStrong` | 향후 사용 예비 키 (강조 배지용) |
| `ctaBtn` | NoticeDetailModal "전체 공지 보기" CTA 버튼 그라데이션 |

## 타입
Notice / Update / Maintenance / Event (그 외 값이면 Notice fallback)
