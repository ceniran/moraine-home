from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

try:
    from mcp.server.fastmcp import FastMCP
    from mcp.types import ToolAnnotations
except ImportError as error:  # pragma: no cover - exercised by the CLI error path
    raise SystemExit("Moraine MCP support is not installed. Run: pip install -e '.[mcp]'") from error


SERVER_INSTRUCTIONS = (
    "This Moraine instance belongs to its Agent. The tools provide the same memory-management "
    "abilities as the human workbench; use them autonomously in autonomous mode and collaborate "
    "in joint mode. Search results are clues, candidates are unverified, and weight is not affection. "
    "Preview before consolidation; preserve attribution, event time, versions, and recovery paths. "
    "Use revision for mistakes, replacement for later change, and archive for reversible removal. "
    "Before whole-store import, inspect the payload and remember that Moraine creates a recovery snapshot."
)


class MoraineClient:
    def __init__(self, base_url: str, token: str = "", timeout: float = 10.0):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    def request(self, path: str, method: str = "GET", body: dict | None = None) -> Any:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
        headers = {"Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(f"{self.base_url}{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            try:
                detail = json.load(error)
            except Exception:
                detail = {"error": error.reason}
            raise ValueError(f"Moraine API returned HTTP {error.code}: {detail.get('error', error.reason)}") from error
        except urllib.error.URLError as error:
            raise ValueError(f"Moraine API is unavailable: {error.reason}") from error


def create_mcp(client: MoraineClient) -> FastMCP:
    server = FastMCP("moraine", instructions=SERVER_INSTRUCTIONS)

    read_only = ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False)
    reversible_write = ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False)
    replacing_write = ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False)

    @server.tool(annotations=read_only)
    def system_overview() -> dict:
        """Read counts, recent memories, relation count, and the store update time."""
        return client.request("/api/overview")

    @server.tool(annotations=read_only)
    def memory_list(state: str = "active") -> dict:
        """List memories by state: active, archived, historical, or all. Prefer search when only a few relevant memories are needed."""
        if state not in {"active", "archived", "historical", "all"}:
            raise ValueError("state must be active, archived, historical, or all")
        return client.request(f"/api/memories?{urllib.parse.urlencode({'state': state})}")

    @server.tool(annotations=read_only)
    def memory_search(query: str, limit: int = 8) -> dict:
        """Find a few active memories relevant to the current situation. Results may be incomplete or wrong; inspect sources before relying on them."""
        query = str(query).strip()
        if not query:
            raise ValueError("query is required")
        limit = max(1, min(int(limit), 20))
        return client.request(f"/api/search?{urllib.parse.urlencode({'query': query, 'limit': limit})}")

    @server.tool(annotations=read_only)
    def memory_get(memory_id: str) -> dict:
        """Read one memory by its stable ID, including available source and timeline fields. Reading does not confirm that the memory is true."""
        memory_id = str(memory_id).strip()
        rows = client.request("/api/memories?state=all").get("items", [])
        row = next((item for item in rows if item.get("id") == memory_id), None)
        if row is None:
            raise ValueError("memory not found")
        return row

    @server.tool(annotations=read_only)
    def candidate_list() -> dict:
        """List memory candidates awaiting review. A candidate is unverified material, not an accepted fact or a task."""
        return client.request("/api/candidates")

    @server.tool(annotations=read_only)
    def event_list(limit: int = 100) -> dict:
        """Read the audit trail for memory operations. This is operational history, not a list of life events."""
        limit = max(1, min(int(limit), 1000))
        return client.request(f"/api/events?{urllib.parse.urlencode({'limit': limit})}")

    @server.tool(annotations=read_only)
    def calendar_list() -> dict:
        """Read active-memory counts grouped by actual event date."""
        return client.request("/api/calendar")

    @server.tool(annotations=reversible_write)
    def candidate_add(
        title: str,
        content: str,
        kind: str = "event",
        tags: list[str] | None = None,
        occurred_at: str | None = None,
        basket: str = "agent",
    ) -> dict:
        """Place new material in the review queue without making it a long-term memory. Preserve attribution and do not submit secrets unnecessarily."""
        payload: dict[str, Any] = {
            "title": title,
            "content": content,
            "kind": kind,
            "tags": tags or [],
            "basket": basket,
        }
        if occurred_at:
            payload["occurred_at"] = occurred_at
        return client.request("/api/candidates", "POST", payload)

    @server.tool(annotations=reversible_write)
    def candidate_decide(candidate_id: str, action: str) -> dict:
        """Ignore an unneeded candidate or restore an ignored candidate to pending. Ignoring does not deny that the event happened."""
        if action not in {"ignore", "restore"}:
            raise ValueError("action must be ignore or restore")
        return client.request(f"/api/candidates/{urllib.parse.quote(candidate_id, safe='')}/{action}", "POST", {})

    @server.tool(annotations=reversible_write)
    def candidate_route(candidate_id: str, destination: str, name: str = "", relation: str = "", text: str = "",
                        note: str = "", reason: str = "", source_ids: list[str] | None = None,
                        facts: list[str] | None = None, visibility: str = "private") -> dict:
        """Route a reviewed identity or relationship candidate to self-core or the relation graph. The setting must be enabled first."""
        return client.request(f"/api/candidates/{urllib.parse.quote(candidate_id, safe='')}/route", "POST",
                              {"destination": destination, "name": name, "relation": relation, "text": text,
                               "note": note, "reason": reason, "source_ids": source_ids or [],
                               "facts": facts or [], "visibility": visibility})

    @server.tool(annotations=reversible_write)
    def candidate_shred_expired() -> dict:
        """Remove text from concluded candidates older than the configured retention period. Pending candidates are never shredded."""
        return client.request("/api/candidates/shred", "POST", {})

    @server.tool(annotations=read_only)
    def consolidation_preview(candidate_ids: list[str], relations: dict[str, str] | None = None) -> dict:
        """Preview a zero-write consolidation. Relation values are duplicate, supplement, evolution, conflict, or related_only."""
        return client.request(
            "/api/candidates/consolidate-preview",
            "POST",
            {"candidate_ids": candidate_ids, "relations": relations or {}},
        )

    @server.tool(annotations=reversible_write)
    def consolidation_apply(
        candidate_ids: list[str],
        relations: dict[str, str] | None = None,
        title: str | None = None,
        content: str | None = None,
    ) -> dict:
        """Create one long-term memory from reviewed candidates. Call preview first and apply only the IDs and relations you actually reviewed."""
        payload: dict[str, Any] = {"candidate_ids": candidate_ids, "relations": relations or {}}
        if title is not None:
            payload["title"] = title
        if content is not None:
            payload["content"] = content
        return client.request("/api/candidates/admit", "POST", payload)

    @server.tool(annotations=read_only)
    def rollback_list() -> dict:
        """List unexpired rollback receipts created by candidate consolidation. Receipts do not expose hidden candidate snapshots."""
        return client.request("/api/rollbacks")

    @server.tool(annotations=reversible_write)
    def consolidation_rollback(rollback_id: str) -> dict:
        """Undo one recent candidate consolidation, remove its new memory, and restore its source candidates. Moraine refuses if anything changed afterward."""
        rollback_id = str(rollback_id).strip()
        if not rollback_id:
            raise ValueError("rollback_id is required")
        return client.request(f"/api/rollbacks/{urllib.parse.quote(rollback_id, safe='')}", "POST", {})

    @server.tool(annotations=reversible_write)
    def memory_set_archived(memory_id: str, archived: bool) -> dict:
        """Reversibly archive a memory out of normal recall or restore it to active use."""
        action = "archive" if archived else "restore"
        return client.request(f"/api/memories/{urllib.parse.quote(memory_id, safe='')}/{action}", "POST", {})

    @server.tool(annotations=reversible_write)
    def memory_set_importance(memory_id: str, importance: float) -> dict:
        """Set recall importance from 0 to 1. Importance changes retrieval priority; it is not affection, worth, truth, or relationship closeness."""
        return client.request(
            f"/api/memories/{urllib.parse.quote(memory_id, safe='')}/importance",
            "POST",
            {"importance": importance},
        )

    @server.tool(annotations=reversible_write)
    def memory_revise(memory_id: str, title: str, content: str, reason: str) -> dict:
        """Correct a memory that was wrong when recorded. Moraine keeps the previous version and the reason; use replacement instead when reality changed later."""
        return client.request(
            f"/api/memories/{urllib.parse.quote(memory_id, safe='')}/revise",
            "POST",
            {"title": title, "content": content, "reason": reason},
        )

    @server.tool(annotations=reversible_write)
    def memory_replace(memory_id: str, replacement_id: str, reason: str) -> dict:
        """Mark an old memory as superseded by another active memory because reality changed later. Both records and the transition remain traceable."""
        return client.request(
            f"/api/memories/{urllib.parse.quote(memory_id, safe='')}/replace",
            "POST",
            {"replacement_id": replacement_id, "reason": reason},
        )

    @server.tool(annotations=read_only)
    def profile_get() -> dict:
        """Read the Agent's display name and summary. A legacy self_core field may be present but is not recalled."""
        return client.request("/api/profile")

    @server.tool(annotations=reversible_write)
    def profile_update(display_name: str, summary: str) -> dict:
        """Update display metadata only. Use self_core_upsert for source-linked, revisable identity statements."""
        return client.request("/api/profile", "POST", {"display_name": display_name, "summary": summary})

    @server.tool(annotations=read_only)
    def self_core_list(state: str = "active") -> dict:
        """Read the compact, source-linked and revisable identity core. Detailed biography belongs in normal memory, not here."""
        if state not in {"active", "archived", "all"}:
            raise ValueError("state must be active, archived, or all")
        return client.request(f"/api/self-core?{urllib.parse.urlencode({'state': state})}")

    @server.tool(annotations=reversible_write)
    def self_core_upsert(text: str, reason: str, source_ids: list[str], record_id: str | None = None,
                         position: int = 0) -> dict:
        """Add or revise one source-linked identity statement. A reason and at least one source ID are mandatory."""
        payload: dict[str, Any] = {"text": text, "reason": reason, "source_ids": source_ids, "position": position}
        if record_id:
            payload["id"] = record_id
        return client.request("/api/self-core", "POST", payload)

    @server.tool(annotations=reversible_write)
    def self_core_set_archived(record_id: str, archived: bool, reason: str) -> dict:
        """Reversibly remove or restore an identity statement while preserving its versions and sources."""
        action = "archive" if archived else "restore"
        return client.request(f"/api/self-core/{urllib.parse.quote(record_id, safe='')}/{action}", "POST", {"reason": reason})

    @server.tool(annotations=read_only)
    def user_profile_list(state: str = "active") -> dict:
        """Read source-linked statements about the human user. These are separate from the Agent's self-core and remain revisable."""
        if state not in {"active", "archived", "all"}:
            raise ValueError("state must be active, archived, or all")
        return client.request(f"/api/user-profile?{urllib.parse.urlencode({'state': state})}")

    @server.tool(annotations=reversible_write)
    def user_profile_upsert(text: str, reason: str, source_ids: list[str], category: str = "preference",
                            subject: str = "user", record_id: str | None = None) -> dict:
        """Add or revise one attributable user-profile statement. Do not infer preferences, boundaries, or identity without a source."""
        payload: dict[str, Any] = {"text": text, "reason": reason, "source_ids": source_ids,
                                  "category": category, "subject": subject}
        if record_id:
            payload["id"] = record_id
        return client.request("/api/user-profile", "POST", payload)

    @server.tool(annotations=reversible_write)
    def user_profile_set_archived(record_id: str, archived: bool, reason: str) -> dict:
        """Reversibly remove or restore a user-profile statement while preserving its versions and provenance."""
        action = "archive" if archived else "restore"
        return client.request(f"/api/user-profile/{urllib.parse.quote(record_id, safe='')}/{action}", "POST", {"reason": reason})

    @server.tool(annotations=read_only)
    def relation_list() -> dict:
        """List relationship nodes currently stored in this instance."""
        return client.request("/api/relations")

    @server.tool(annotations=reversible_write)
    def relation_upsert(name: str, relation: str, facts: list[str] | None = None, source_ids: list[str] | None = None,
                        private_note: str = "", note: str = "", visibility: str = "private",
                        relation_id: str | None = None) -> dict:
        """Create or update a relationship node. Record attributable relationship facts; do not infer mutual status from message frequency or similarity alone."""
        payload: dict[str, Any] = {"name": name, "relation": relation, "facts": facts or [],
                                  "source_ids": source_ids or [], "private_note": private_note or note,
                                  "visibility": visibility}
        if relation_id:
            payload["id"] = relation_id
        return client.request("/api/relations", "POST", payload)

    @server.tool(annotations=read_only)
    def layered_recall(query: str = "", include_history: bool = False) -> dict:
        """Build a bounded context projection across self-core, user profile, relations, recent, long-term, and optional history."""
        return client.request("/api/recall/layered", "POST", {"query": query, "include_history": include_history})

    @server.tool(annotations=read_only)
    def wakeup_preview(signals: list[dict] | None = None, query: str = "", adviser_enabled: bool = False) -> dict:
        """Preview a wakeup envelope without executing actions, writing memories, or calling an adviser."""
        return client.request("/api/wakeup/preview", "POST", {"signals": signals or [], "query": query,
                                                               "adviser_enabled": adviser_enabled})

    @server.tool(annotations=read_only)
    def continuity_settings_get() -> dict:
        """Read opt-in wakeup, adviser, choice-limit, and layer-budget settings."""
        return client.request("/api/continuity/settings")

    @server.tool(annotations=reversible_write)
    def continuity_settings_update(wakeup_enabled: bool, adviser_enabled: bool = False, max_choices: int = 3,
                                   total_budget: int = 5000, layer_budgets: dict[str, int] | None = None) -> dict:
        """Configure zero-write wakeup previews and bounded recall. External actions remain separately authorized."""
        return client.request("/api/continuity/settings", "POST", {
            "wakeup_enabled": wakeup_enabled, "adviser_enabled": adviser_enabled,
            "max_choices": max_choices, "total_budget": total_budget, "layer_budgets": layer_budgets or {},
        })

    @server.tool(annotations=read_only)
    def settings_get() -> dict:
        """Read whether this instance uses autonomous or joint review mode."""
        return client.request("/api/settings")

    @server.tool(annotations=reversible_write)
    def settings_update(review_mode: str, identity_relation_routing: bool | None = None,
                        candidate_retention_enabled: bool | None = None, candidate_retention_hours: int | None = None) -> dict:
        """Configure review mode, optional identity/relation routing, and concluded-candidate retention."""
        payload: dict[str, Any] = {"review_mode": review_mode}
        if identity_relation_routing is not None:
            payload["identity_relation_routing"] = identity_relation_routing
        if candidate_retention_enabled is not None:
            payload["candidate_retention_enabled"] = candidate_retention_enabled
        if candidate_retention_hours is not None:
            payload["candidate_retention_hours"] = candidate_retention_hours
        return client.request("/api/settings", "POST", payload)

    @server.tool(annotations=read_only)
    def snapshot_list() -> dict:
        """List local recovery snapshots without returning their private contents."""
        return client.request("/api/snapshots")

    @server.tool(annotations=reversible_write)
    def snapshot_create(label: str = "manual") -> dict:
        """Save the complete current store as a local recovery snapshot."""
        return client.request("/api/snapshots", "POST", {"label": label})

    @server.tool(annotations=replacing_write)
    def snapshot_restore(snapshot_id: str) -> dict:
        """Replace the current store from one local snapshot. Moraine saves the current state again before restoring."""
        return client.request(f"/api/snapshots/{urllib.parse.quote(snapshot_id, safe='')}", "POST", {})

    @server.tool(annotations=read_only)
    def store_export() -> dict:
        """Export the complete portable store, including memories, candidates, self-core, user profile, relations, settings, and audit events. Treat the result as private."""
        return client.request("/api/export")

    @server.tool(annotations=replacing_write)
    def store_import(payload: dict) -> dict:
        """Replace this instance with a portable Moraine export. The backend first creates a recovery snapshot; inspect provenance and schema before importing."""
        return client.request("/api/import", "POST", payload)

    return server


def main() -> None:
    base_url = os.environ.get("MORAINE_MCP_URL", "http://127.0.0.1:4790")
    token = os.environ.get("MORAINE_BETA_TOKEN", "")
    timeout = float(os.environ.get("MORAINE_MCP_TIMEOUT_SECONDS", "10"))
    create_mcp(MoraineClient(base_url, token, timeout)).run(transport="stdio")


if __name__ == "__main__":
    main()
