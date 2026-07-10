#!/usr/bin/env python3
"""Probe Quilt package search for Benchling linkage metadata.

This script intentionally lives outside the service path. It validates whether
``quilt3.search`` can find linked packages across all accessible buckets, and
whether bucket-scoped search returns the same package when a bucket is known.
"""

from __future__ import annotations

import argparse
import json
import os
from typing import Any

import quilt3
from quilt3.util import QuiltException


def _normalize_catalog(catalog: str) -> str:
    catalog = catalog.strip()
    if not catalog:
        raise ValueError("catalog is required")
    if not catalog.startswith(("http://", "https://")):
        catalog = f"https://{catalog}"
    return catalog.rstrip("/")


def _summarize_hit(hit: dict[str, Any]) -> dict[str, Any]:
    source = hit.get("_source", hit)
    metadata = source.get("metadata") or source.get("mnfst_metadata") or {}
    return {
        "index": hit.get("_index"),
        "id": hit.get("_id"),
        "score": hit.get("_score"),
        "handle": source.get("handle") or hit.get("handle"),
        "registry": source.get("registry") or source.get("bucket") or hit.get("registry"),
        "metadata": {
            k: metadata.get(k)
            for k in sorted(metadata)
            if k in {"entry_id", "display_id", "experiment_id", "package_name"}
        },
    }


def _run_query(label: str, query: str | dict[str, Any], limit: int) -> list[dict[str, Any]]:
    print(f"\n## {label}")
    print(f"query: {json.dumps(query) if isinstance(query, dict) else query}")
    try:
        hits = quilt3.search(query, limit=limit)
    except QuiltException as exc:
        print(f"error: {exc}")
        return []
    print(f"hits: {len(hits)}")
    for hit in hits[: min(limit, 5)]:
        print(json.dumps(_summarize_hit(hit), indent=2, sort_keys=True))
    return hits


def _bucket_uri(bucket: str) -> str:
    if bucket.startswith("s3://"):
        return bucket
    return f"s3://{bucket}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", default=os.getenv("QUILT_WEB_HOST", "nightly.quilttest.com"))
    parser.add_argument("--key", default=os.getenv("PKG_KEY", "experiment_id"))
    parser.add_argument("--value", default=os.getenv("PKG_VALUE", "EXP26000012"))
    parser.add_argument("--bucket", default=os.getenv("QUILT_USER_BUCKET", ""))
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument(
        "--refresh-token-env",
        default="QUILT_REFRESH_TOKEN",
        help="Environment variable containing a Quilt refresh token. If absent, existing quilt3 auth is used.",
    )
    args = parser.parse_args()

    catalog = _normalize_catalog(args.catalog)
    print(f"catalog: {catalog}")
    print(f"metadata: {args.key}={args.value}")
    print(f"bucket: {args.bucket or '<all accessible buckets>'}")

    quilt3.config(catalog)

    refresh_token = os.getenv(args.refresh_token_env, "").strip()
    if refresh_token:
        print(f"auth: logging in with refresh token from ${args.refresh_token_env}")
        quilt3.login_with_token(refresh_token)  # type: ignore[attr-defined]
    else:
        print("auth: using existing quilt3 auth, if any")

    print(f"logged_in: {quilt3.logged_in()}")

    query_string = f'{args.key}:"{args.value}"'
    _run_query("global query_string search", query_string, args.limit)

    query_dsl = {
        "query": {
            "bool": {
                "should": [
                    {"term": {f"metadata.{args.key}.keyword": args.value}},
                    {"term": {f"mnfst_metadata.{args.key}.keyword": args.value}},
                    {"query_string": {"query": query_string}},
                ],
                "minimum_should_match": 1,
            }
        }
    }
    _run_query("global DSL search", query_dsl, args.limit)

    if args.bucket:
        print("\n## bucket-scoped search")
        bucket = quilt3.Bucket(_bucket_uri(args.bucket))
        try:
            hits = bucket.search(query_string, limit=args.limit)
        except QuiltException as exc:
            print(f"error: {exc}")
            return
        print(f"hits: {len(hits)}")
        for hit in hits[: min(args.limit, 5)]:
            print(json.dumps(_summarize_hit(hit), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
