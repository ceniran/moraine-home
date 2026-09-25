from __future__ import annotations

import json
import os
import threading
from pathlib import Path


class AdviserSecretStore:
    """Stores optional adviser credentials outside memories and portable exports."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.lock = threading.RLock()

    def _read(self) -> dict:
        if not self.path.exists():
            return {}
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return value if isinstance(value, dict) else {}

    def public(self) -> dict:
        value = self._read()
        return {
            "provider": "jev",
            "configured": bool(str(value.get("api_key") or "").strip()),
            "enabled": bool(value.get("enabled", False)),
            "use_for_wakeup": bool(value.get("use_for_wakeup", True)),
        }

    def update(self, value: dict) -> dict:
        with self.lock:
            current = self._read()
            key = str(value.get("api_key") or current.get("api_key") or "").strip()
            if value.get("clear_api_key") is True:
                key = ""
            if len(key) > 512:
                raise ValueError("Jev API key must contain at most 512 characters")
            enabled = bool(value.get("enabled", current.get("enabled", False)))
            if enabled and not key:
                raise ValueError("configure a Jev API key before enabling the adviser")
            payload = {
                "api_key": key,
                "enabled": enabled if key else False,
                "use_for_wakeup": bool(value.get("use_for_wakeup", current.get("use_for_wakeup", True))),
            }
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix(self.path.suffix + ".tmp")
            temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            os.chmod(temporary, 0o600)
            os.replace(temporary, self.path)
            os.chmod(self.path, 0o600)
            return self.public()
