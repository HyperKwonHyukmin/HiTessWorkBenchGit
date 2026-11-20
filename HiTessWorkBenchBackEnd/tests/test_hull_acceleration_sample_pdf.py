"""선체 가속도 샘플 PDF 위치 — 설정(UNC) 우선, 없으면 로컬 SampleFile/TS (2026-11-16).

145 의 로컬 샘플은 DRM 에 감싸져 복호화가 끊기면 열리지 않았다. 그래서 평문 UNC 샘플을
기본으로 쓰고, 실행은 작업 폴더로 복사하지 않고 원본 경로를 엔진에 넘긴다.
"""
import os

from app.routers import analysis


def test_configured_sample_wins(tmp_path, monkeypatch):
    sample = tmp_path / "net_sample.pdf"
    sample.write_bytes(b"%PDF-1.7\n")
    monkeypatch.setenv("HULL_ACCEL_SAMPLE_PDF", str(sample))
    assert analysis._hull_accel_sample_pdf() == str(sample)
    assert analysis._is_hull_accel_sample_pdf(str(sample))
    assert not analysis._is_hull_accel_sample_pdf(str(tmp_path / "other.pdf"))
    assert not analysis._is_hull_accel_sample_pdf(None)


def test_falls_back_to_local_folder(tmp_path, monkeypatch):
    monkeypatch.setenv("HULL_ACCEL_SAMPLE_PDF", str(tmp_path / "missing.pdf"))
    backend = tmp_path / "backend"
    local = backend / "SampleFile" / "TS"
    local.mkdir(parents=True)
    (local / ".gitkeep").write_text("")
    (local / "b.pdf").write_bytes(b"%PDF")
    (local / "a.pdf").write_bytes(b"%PDF")
    monkeypatch.setattr(analysis, "get_backend_dir", lambda: str(backend))
    assert analysis._hull_accel_sample_pdf() == os.path.join(str(local), "a.pdf")


def test_none_when_nothing(tmp_path, monkeypatch):
    monkeypatch.setenv("HULL_ACCEL_SAMPLE_PDF", str(tmp_path / "missing.pdf"))
    monkeypatch.setattr(analysis, "get_backend_dir", lambda: str(tmp_path / "nobackend"))
    assert analysis._hull_accel_sample_pdf() is None
