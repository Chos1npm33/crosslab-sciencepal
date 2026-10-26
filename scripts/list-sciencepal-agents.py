"""List accessible SciencePal agents using the official SDK; never starts a run."""

import argparse
import asyncio
import os
import sys


async def list_agents(api_key: str, search: str, page: int, limit: int) -> int:
    try:
        from sciencepal import SciencePal
    except ImportError:
        print("缺少官方 sciencepal SDK，请按 docs/sciencepal-setup.md 安装。", file=sys.stderr)
        return 1

    try:
        async with SciencePal(api_key=api_key) as client:
            agents, pagination = await client.agents.list(search=search, page=page, limit=limit)
        for agent in agents:
            print(f"{agent.name}\t{agent.id}")
        print(f"Page {page} / {pagination.pages}; returned {len(agents)} agents")
        return 0
    except Exception as error:
        # SDK exceptions can include response content; keep credentials and account data out of logs.
        print(f"查询失败（{type(error).__name__}）。请检查 Key、权限及网络。", file=sys.stderr)
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="只读查询 SciencePal Agent 名称和 ID")
    parser.add_argument("--search", default="", help="按 Agent 名称搜索")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--limit", type=int, default=100)
    args = parser.parse_args()
    if args.page < 1 or not 1 <= args.limit <= 100:
        parser.error("page 应大于等于 1，limit 应为 1–100。")

    api_key = os.environ.get("SCIENCEPAL_API_KEY", "").strip()
    if not api_key:
        print("请先在运行终端设置 SCIENCEPAL_API_KEY 环境变量。脚本不会读取 .dev.vars。", file=sys.stderr)
        return 1
    return asyncio.run(list_agents(api_key, args.search, args.page, args.limit))


if __name__ == "__main__":
    sys.exit(main())
