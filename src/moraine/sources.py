from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


def _rows(payload: Any) -> list[dict]:
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = next(
            (payload[key] for key in ("items", "documents", "memories") if isinstance(payload.get(key), list)),
            None,
        )
        if rows is None:
            raise ValueError("source object must contain an items, documents, or memories array")
    else:
        raise ValueError("source must return an array or a supported wrapper object")
    return [dict(row) for row in rows if isinstance(row, dict)]


class JsonFileSource:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def load(self) -> list[dict]:
        return _rows(json.loads(self.path.read_text(encoding="utf-8")))


class HttpSource:
    def __init__(self, list_url: str, detail_url: str = "", token: str = "", timeout: float = 15):
        if not list_url:
            raise ValueError("MORAINE_HTTP_LIST_URL is required in http mode")
        self.list_url = list_url
        self.detail_url = detail_url
        self.token = token
        self.timeout = timeout

    def _get(self, url: str) -> Any:
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            return json.load(response)

    def load(self) -> list[dict]:
        rows = _rows(self._get(self.list_url))
        if not self.detail_url:
            return rows
        result = []
        for row in rows:
            if "id" not in row:
                raise ValueError("every source item must have an id")
            url = self.detail_url.replace("{id}", urllib.parse.quote(str(row["id"]), safe=""))
            detail = self._get(url)
            if not isinstance(detail, dict):
                raise ValueError("detail source must return an object")
            result.append(detail)
        return result
