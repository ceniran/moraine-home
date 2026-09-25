#!/usr/bin/env python3
"""Synthetic multi-user endurance check for the AML adapter."""

from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path
from tempfile import TemporaryDirectory

from moraine.aml_adapter import AMLAdapter
from moraine.server import FastEmbedder


TARGETS = [
    ("现在的发布代号是什么？", "经过两次调整，当前发布代号最终确定为苔原。"),
    ("纪念植物最后选了什么？", "纪念植物最初考虑铃兰，后来最终选择了迷迭香。"),
    ("每周例会现在几点开始？", "每周例会从上午九点调整为当前上午十点半开始。"),
    ("故障时怎样保住尚未提交的文字？", "自动保存服务故障时，尚未提交的文字会留在本地草稿。"),
    ("负责手机视觉复核的人是谁？", "设计师周岚负责手机端视觉复核。"),
    ("不再使用哪一种登录方式？", "团队明确停止使用短信验证码登录，改用安全密钥。"),
    ("最终决定乘什么去会场？", "出行计划从飞机改为高铁，最终决定乘高铁去会场。"),
    ("向量不可用时靠什么检索？", "本地向量不可用时，系统降级使用关键词检索。"),
]


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int((len(ordered) - 1) * fraction))]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="BAAI/bge-small-zh-v1.5")
    parser.add_argument("--cache", default="./models")
    parser.add_argument("--users", type=int, default=3)
    parser.add_argument("--messages", type=int, default=60)
    args = parser.parse_args()
    embedder = FastEmbedder(args.model, args.cache, 2)
    add_times: list[float] = []
    search_times: list[float] = []
    with TemporaryDirectory() as directory:
        root = Path(directory)
        adapter = AMLAdapter(root, embedder, 4)
        expected_by_user: dict[str, list[str]] = {}
        first_request = None
        for user_index in range(args.users):
            user_id = f"endurance-user-{user_index}"
            target_rows = [
                content.replace("苔原", f"苔原-{user_index}") if index == 0 else content
                for index, (_query, content) in enumerate(TARGETS)
            ]
            expected_by_user[user_id] = target_rows
            messages = []
            for index in range(args.messages):
                if index < len(target_rows):
                    content = target_rows[index]
                else:
                    content = (f"用户{user_index}的合成日常记录{index}：完成普通任务、整理桌面并检查编号"
                               f"{user_index:02d}-{index:03d}，没有产生新的状态变更。")
                messages.append({"role": "user" if index % 2 == 0 else "assistant", "content": content,
                                 "timestamp": 1722470400000 + index * 60000})
            for start in range(0, len(messages), 5):
                body = {"request_id": f"{user_id}-request-{start // 5}", "user_id": user_id,
                        "session_id": f"session-{start // 10}", "messages": messages[start:start + 5]}
                first_request = first_request or body
                before = time.perf_counter()
                adapter.add(body)
                add_times.append((time.perf_counter() - before) * 1000)

        before_retry = sum(len(json.loads(path.read_text())["memories"]) for path in root.glob("*.json"))
        adapter.add(first_request)
        after_retry = sum(len(json.loads(path.read_text())["memories"]) for path in root.glob("*.json"))

        adapter = AMLAdapter(root, embedder, 4)
        ranks = []
        result_counts = []
        for user_id, expected_rows in expected_by_user.items():
            for (query, _content), expected in zip(TARGETS, expected_rows, strict=True):
                before = time.perf_counter()
                results = adapter.search({"query": query, "user_id": user_id, "top_k": 100})["data"]
                search_times.append((time.perf_counter() - before) * 1000)
                result_counts.append(len(results))
                ranks.append(next((index + 1 for index, row in enumerate(results) if row["content"] == expected), 0))

        isolation = adapter.search({"query": "当前发布代号", "user_id": "unknown-user", "top_k": 100})["data"] == []
        report = {
            "users": args.users,
            "messages_per_user": args.messages,
            "stored_messages": after_retry,
            "idempotent_retry": before_retry == after_retry,
            "unknown_user_isolated": isolation,
            "top_k_100_respected": all(count <= 100 for count in result_counts),
            "minimum_results_returned": min(result_counts),
            "top_1": sum(rank == 1 for rank in ranks),
            "top_3": sum(0 < rank <= 3 for rank in ranks),
            "queries": len(ranks),
            "add_ms": {"median": round(statistics.median(add_times), 2),
                       "p95": round(percentile(add_times, 0.95), 2)},
            "search_ms": {"median": round(statistics.median(search_times), 2),
                          "p95": round(percentile(search_times, 0.95), 2)},
            "index_bytes": sum(path.stat().st_size for path in root.glob("*.json")),
            "failures": [index for index, rank in enumerate(ranks) if rank != 1],
        }
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if (report["idempotent_retry"] and isolation and report["top_k_100_respected"]
                     and report["top_3"] == report["queries"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
