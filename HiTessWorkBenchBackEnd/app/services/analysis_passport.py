"""Read-only, bounded artifact provenance for an Analysis record."""
from __future__ import annotations

import hashlib
import os
import stat
import urllib.parse
from datetime import datetime
from typing import Any, Iterator

from .. import models
from ..routers._access_control import owner_from_userconnection_path
from .program_registry import resolve_program

_CHUNK_BYTES = 1024 * 1024
_DEFAULT_MAX_FILE_BYTES = 256 * 1024 * 1024
_DEFAULT_MAX_TOTAL_BYTES = 512 * 1024 * 1024
_MAX_JSON_DEPTH = 4
_MAX_CANDIDATES = 256
_DEFAULT_MAX_JSON_NODES = 4096


def _env_limit(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


def _iso(value: Any) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else None


def _iter_string_candidates(
    value: Any,
    *,
    prefix: str,
    budget: dict[str, int | bool],
    depth: int = 0,
) -> Iterator[tuple[str, str]]:
    """Yield JSON string leaves without allowing unbounded/nested traversal."""
    remaining = int(budget["remaining"])
    if remaining <= 0:
        budget["limit_hit"] = True
        return
    budget["remaining"] = remaining - 1
    if depth > _MAX_JSON_DEPTH:
        return
    if isinstance(value, dict):
        for key, child in value.items():
            if bool(budget["limit_hit"]):
                break
            if not isinstance(key, str):
                continue
            child_prefix = f"{prefix}.{key}" if prefix else key
            yield from _iter_string_candidates(
                child,
                prefix=child_prefix,
                budget=budget,
                depth=depth + 1,
            )
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            if bool(budget["limit_hit"]):
                break
            child_prefix = f"{prefix}[{index}]"
            yield from _iter_string_candidates(
                child,
                prefix=child_prefix,
                budget=budget,
                depth=depth + 1,
            )
    elif isinstance(value, str) and value:
        yield prefix, value


def _safe_basename(path: str) -> str:
    name = os.path.basename(path)
    return name or "unnamed"


def _is_within(base: str, candidate: str) -> bool:
    try:
        return os.path.commonpath(
            [os.path.normcase(base), os.path.normcase(candidate)]
        ) == os.path.normcase(base)
    except ValueError:
        return False


def _artifact_error(role: str, name: str, status: str) -> dict:
    return {
        "role": role,
        "name": name,
        "status": status,
        "sizeBytes": None,
        "modifiedAt": None,
        "sha256": None,
    }


def _hash_regular_file(
    path: str,
    *,
    role: str,
    max_file_bytes: int,
    remaining_bytes: int,
) -> tuple[dict, int]:
    try:
        before = os.stat(path, follow_symlinks=False)
    except OSError:
        return _artifact_error(role, _safe_basename(path), "missing"), 0

    if not stat.S_ISREG(before.st_mode) or os.path.islink(path):
        return _artifact_error(role, _safe_basename(path), "not_regular_file"), 0
    if before.st_size > max_file_bytes:
        artifact = _artifact_error(role, _safe_basename(path), "file_too_large")
        artifact["sizeBytes"] = before.st_size
        artifact["modifiedAt"] = datetime.fromtimestamp(before.st_mtime).isoformat()
        return artifact, 0
    if before.st_size > remaining_bytes:
        artifact = _artifact_error(role, _safe_basename(path), "total_limit_exceeded")
        artifact["sizeBytes"] = before.st_size
        artifact["modifiedAt"] = datetime.fromtimestamp(before.st_mtime).isoformat()
        return artifact, 0

    digest = hashlib.sha256()
    bytes_read = 0
    read_limit = min(before.st_size, max_file_bytes, remaining_bytes)
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0)
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(path, flags)
        try:
            opened = os.fstat(fd)
            if not stat.S_ISREG(opened.st_mode):
                return _artifact_error(role, _safe_basename(path), "not_regular_file"), 0
            if (
                before.st_dev != opened.st_dev
                or before.st_ino != opened.st_ino
                or before.st_size != opened.st_size
                or before.st_mtime_ns != opened.st_mtime_ns
            ):
                artifact = _artifact_error(
                    role,
                    _safe_basename(path),
                    "changed_during_read",
                )
                artifact["sizeBytes"] = opened.st_size
                artifact["modifiedAt"] = datetime.fromtimestamp(opened.st_mtime).isoformat()
                return artifact, 0
            while bytes_read < read_limit:
                chunk = os.read(fd, min(_CHUNK_BYTES, read_limit - bytes_read))
                if not chunk:
                    break
                digest.update(chunk)
                bytes_read += len(chunk)
            opened_after = os.fstat(fd)
        finally:
            os.close(fd)
        after = os.stat(path, follow_symlinks=False)
    except OSError:
        return _artifact_error(role, _safe_basename(path), "read_error"), 0

    changed = (
        before.st_dev != opened.st_dev
        or before.st_ino != opened.st_ino
        or opened.st_dev != opened_after.st_dev
        or opened.st_ino != opened_after.st_ino
        or opened_after.st_dev != after.st_dev
        or opened_after.st_ino != after.st_ino
        or before.st_size != after.st_size
        or opened.st_size != opened_after.st_size
        or before.st_mtime_ns != after.st_mtime_ns
        or opened.st_mtime_ns != opened_after.st_mtime_ns
        or bytes_read != before.st_size
    )
    return {
        "role": role,
        "name": _safe_basename(path),
        "status": "changed_during_read" if changed else "verified",
        "sizeBytes": after.st_size,
        "modifiedAt": datetime.fromtimestamp(after.st_mtime).isoformat(),
        "sha256": None if changed else digest.hexdigest(),
    }, bytes_read


def build_analysis_passport(
    record: models.Analysis,
    *,
    user_connection_base: str,
) -> dict:
    """Build a bounded passport without exposing stored filesystem paths."""
    base_real = os.path.realpath(os.path.abspath(user_connection_base))
    max_file_bytes = _env_limit("WORKBENCH_PASSPORT_MAX_FILE_BYTES", _DEFAULT_MAX_FILE_BYTES)
    max_total_bytes = _env_limit("WORKBENCH_PASSPORT_MAX_TOTAL_BYTES", _DEFAULT_MAX_TOTAL_BYTES)
    max_json_nodes = _env_limit("WORKBENCH_PASSPORT_MAX_JSON_NODES", _DEFAULT_MAX_JSON_NODES)
    spec = resolve_program(record.program_name)

    raw_candidates: list[tuple[str, str]] = []
    candidate_limit_hit = False
    traversal_budget: dict[str, int | bool] = {
        "remaining": max_json_nodes,
        "limit_hit": False,
    }
    for group_name, value in (("input", record.input_info), ("result", record.result_info)):
        for role, candidate in _iter_string_candidates(
            value,
            prefix=group_name,
            budget=traversal_budget,
        ):
            if len(raw_candidates) >= _MAX_CANDIDATES:
                candidate_limit_hit = True
                break
            raw_candidates.append((role, candidate))
        if candidate_limit_hit or bool(traversal_budget["limit_hit"]):
            break

    artifacts: list[dict] = []
    seen: set[str] = set()
    total_hashed_bytes = 0
    owner = (record.employee_id or "").strip().casefold()

    for role, stored_value in raw_candidates:
        decoded_value = urllib.parse.unquote(stored_value)
        # Strings that do not identify an existing or path-shaped filesystem value
        # are ordinary input metadata, not artifacts.
        if not (
            os.path.isabs(decoded_value)
            or os.path.sep in decoded_value
            or (os.path.altsep and os.path.altsep in decoded_value)
        ):
            continue
        candidate_abs = os.path.abspath(decoded_value)
        candidate_real = os.path.realpath(candidate_abs)
        dedupe_key = os.path.normcase(candidate_real)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        name = _safe_basename(candidate_abs)
        if not _is_within(base_real, candidate_real):
            artifacts.append(_artifact_error(role, name, "outside_workspace"))
            continue
        path_owner = owner_from_userconnection_path(candidate_real, base_real)
        if not path_owner or path_owner.strip().casefold() != owner:
            artifacts.append(_artifact_error(role, name, "owner_mismatch"))
            continue

        artifact, consumed = _hash_regular_file(
            candidate_real,
            role=role,
            max_file_bytes=max_file_bytes,
            remaining_bytes=max_total_bytes - total_hashed_bytes,
        )
        artifacts.append(artifact)
        total_hashed_bytes += consumed

    statuses = {artifact["status"] for artifact in artifacts}
    node_limit_hit = bool(traversal_budget["limit_hit"])
    if candidate_limit_hit or node_limit_hit:
        integrity_status = "partial"
    elif not artifacts:
        integrity_status = "no_artifacts"
    elif statuses == {"verified"}:
        integrity_status = "verified"
    elif "verified" in statuses:
        integrity_status = "partial"
    else:
        integrity_status = "unverified"

    return {
        "analysisId": record.id,
        "projectName": record.project_name,
        "program": {
            "persistedName": record.program_name,
            "id": spec.program_id if spec else None,
            "displayName": spec.display_name if spec else record.program_name,
            "capabilities": sorted(spec.capabilities) if spec else [],
            "rerunnable": bool(spec and spec.rerun_adapter),
            "known": spec is not None,
        },
        "analysisStatus": record.status,
        "jobStatus": record.job_status,
        "source": record.source,
        "createdAt": _iso(record.created_at),
        "integrity": {
            "status": integrity_status,
            "candidateLimitHit": candidate_limit_hit,
            "nodeLimitHit": node_limit_hit,
            "artifactCount": len(artifacts),
            "verifiedCount": sum(1 for item in artifacts if item["status"] == "verified"),
            "hashedBytes": total_hashed_bytes,
        },
        "artifacts": artifacts,
    }
