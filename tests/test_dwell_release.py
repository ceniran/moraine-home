import unittest
import tomllib
from pathlib import Path


STATIC = Path(__file__).parents[1] / "src" / "moraine" / "static" / "dwell-release"


class DwellReleaseTests(unittest.TestCase):
    def test_release_bundle_keeps_old_beta_as_a_parallel_frontend(self):
        self.assertTrue((STATIC.parent / "dwell-v2" / "index.html").is_file())
        self.assertTrue((STATIC / "index.html").is_file())
        self.assertTrue((STATIC / "prototype.js").is_file())
        self.assertTrue((STATIC / "prototype.css").is_file())

    def test_wheel_manifest_includes_release_and_rollback_frontends(self):
        project = tomllib.loads((STATIC.parents[3] / "pyproject.toml").read_text(encoding="utf-8"))
        package_data = project["tool"]["setuptools"]["package-data"]["moraine"]
        self.assertIn("static/dwell-release/*", package_data)
        self.assertIn("static/dwell-release/assets/*", package_data)
        self.assertIn("static/dwell-v2/*", package_data)
        self.assertIn("static/dwell-v2/assets/*", package_data)

    def test_release_runtime_maps_shared_api_and_blocks_private_routes(self):
        runtime = (STATIC / "release-runtime.js").read_text(encoding="utf-8")
        self.assertIn("'/api/memory-preview/'", runtime)
        self.assertIn("'/api/cairn/profile'", runtime)
        self.assertIn("/api/profile", runtime)
        self.assertIn("method: 'POST'", runtime)
        self.assertIn("'/api/diary'", runtime)
        self.assertIn("private_route_disabled", runtime)
        self.assertIn("#study", runtime)

    def test_release_index_loads_boundary_before_application_script(self):
        index = (STATIC / "index.html").read_text(encoding="utf-8")
        self.assertIn("Moraine · 记忆工作台", index)
        self.assertIn("data-connection-shield", index)
        self.assertIn('id="cairn"', index)
        self.assertIn('data-view="cairn"', index)
        self.assertIn("小机主页", index)
        self.assertNotIn('id="study"', index)
        self.assertNotIn('data-view="study"', index)
        self.assertNotIn("PRIVATE AGENT STUDY", index)
        self.assertIn('id="identityRoutingTitle"', index)
        self.assertIn('id="profileRecallTitle"', index)
        self.assertIn('data-profile-module="agent_profile"', index)
        self.assertIn('data-profile-module="user_profile"', index)
        self.assertLess(index.index("release-runtime.js"), index.index("prototype.js?v=20261111-release-6"))

    def test_release_keeps_generic_candidate_settings_visible(self):
        runtime = (STATIC / "release-runtime.js").read_text(encoding="utf-8")
        removal = next(line for line in runtime.splitlines() if "profileRoutingCleanupTitle" in line)
        self.assertNotIn("profileRecallTitle", removal)
        self.assertNotIn("identityRoutingTitle", removal)

    def test_release_uses_standalone_routes_and_falls_back_to_core_backend_progress(self):
        index = (STATIC / "index.html").read_text(encoding="utf-8")
        script = (STATIC / "prototype.js").read_text(encoding="utf-8")
        runtime = (STATIC / "release-runtime.js").read_text(encoding="utf-8")

        self.assertIn("专项候选", index)
        self.assertIn("fetch('/api/memory-preview/candidates', { cache:'no-store' })", script)
        self.assertIn("routingPayload.items || routingPayload.candidates", script)
        self.assertIn("backendRevisionAvailable", script)
        self.assertIn("if (!backendRevisionAvailable) return;", script)
        self.assertNotIn("remove('[data-memory-processing-roadmap]')", runtime)
        self.assertIn("backendRevisionQueue: false", runtime)
        self.assertIn("后端接入进度", script)
        self.assertIn("Moraine 核心后端可用", script)
        self.assertIn("fetch('/api/memory-preview/queue'", script)
        self.assertIn("fetch('/api/memory-preview/candidates'", script)


if __name__ == "__main__":
    unittest.main()
