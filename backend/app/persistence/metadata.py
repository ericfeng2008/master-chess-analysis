from __future__ import annotations

from typing import Any


CORE_METADATA_KEYS = ("Event", "White", "Black")
METADATA_MAX_LENGTH = 200


def usable_metadata_value(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized if normalized and normalized != "?" else None


def core_metadata_from_headers(headers: dict[str, Any]) -> dict[str, str]:
    return {
        key: value
        for key in CORE_METADATA_KEYS
        if (value := usable_metadata_value(headers.get(key))) is not None
    }


def merge_imported_metadata(
    existing: dict[str, Any], headers: dict[str, Any]
) -> dict[str, str]:
    result = {
        key: value
        for key in CORE_METADATA_KEYS
        if (value := usable_metadata_value(existing.get(key))) is not None
    }
    result.update(core_metadata_from_headers(headers))
    return result


def effective_metadata(
    source_headers: dict[str, Any],
    imported: dict[str, Any],
    overrides: dict[str, Any],
) -> tuple[dict[str, str], dict[str, str], list[str], dict[str, str]]:
    values: dict[str, str] = {}
    sources: dict[str, str] = {}
    for key in CORE_METADATA_KEYS:
        override = usable_metadata_value(overrides.get(key))
        imported_value = usable_metadata_value(imported.get(key))
        if override is not None:
            values[key] = override
            sources[key] = "manual"
        elif imported_value is not None:
            values[key] = imported_value
            sources[key] = "imported"
        else:
            sources[key] = "missing"
    missing = [key for key in CORE_METADATA_KEYS if key not in values]
    headers = {
        key: str(value)
        for key, value in source_headers.items()
        if isinstance(value, str) and key not in CORE_METADATA_KEYS
    }
    headers.update(values)
    return values, sources, missing, headers


def normalize_override(value: object, field: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field} must be text or null")
    normalized = value.strip()
    if not normalized or normalized == "?":
        return None
    if len(normalized) > METADATA_MAX_LENGTH:
        raise ValueError(f"{field} must contain at most {METADATA_MAX_LENGTH} characters")
    return normalized
