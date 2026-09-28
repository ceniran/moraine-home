import unittest

from moraine.candidate_capture import write_guidance


class CandidateCaptureGuidanceTest(unittest.TestCase):
    def test_single_write_reminds_once_without_forcing_more_memory(self):
        result = write_guidance(
            [{"title": "一件事", "content": "一个稳定结果"}],
            episode_id="episode_one",
            episode_complete=False,
            batch=False,
        )
        self.assertEqual(result["choices"], ["complete", "add_more"])
        self.assertTrue(result["needs_episode_confirmation"])
        self.assertFalse(result["possible_multiple_events"])

    def test_suspected_multi_event_text_is_only_advisory(self):
        result = write_guidance(
            [{"title": "两项变化", "content": "先完成接口，另外修复页面"}],
            episode_id="episode_two",
            episode_complete=False,
            batch=False,
        )
        self.assertTrue(result["possible_multiple_events"])
        self.assertIn("topic_transition", result["signals"])

    def test_explicit_completion_closes_the_prompt(self):
        result = write_guidance(
            [{"title": "结束", "content": "没有更多事件"}],
            episode_id="episode_done",
            episode_complete=True,
            batch=True,
        )
        self.assertEqual(result["status"], "complete")
        self.assertFalse(result["needs_episode_confirmation"])


if __name__ == "__main__":
    unittest.main()
