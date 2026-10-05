"""Quilt registry GraphQL client for package locks."""

from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Dict, Optional

import requests
import structlog

logger = structlog.get_logger(__name__)

LOCK_QUERY = """
query ($bucket: String!, $name: String!) {
  package(bucket: $bucket, name: $name) { lock { hash lockedAt } }
}
"""

LOCK_MUTATION = """
mutation ($bucket: String!, $name: String!, $hash: String!, $reason: String) {
  packageLock(bucket: $bucket, name: $name, hash: $hash, reason: $reason) {
    __typename
    ... on PackageLock { hash lockedAt }
    ... on OperationError { name message }
    ... on InvalidInput { errors { name message } }
  }
}
"""


@dataclass(frozen=True)
class LockState:
    """A package's lock (``hash``, ``lockedAt``) and why it is not at the sealed revision, if it is not."""

    lock: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


@lru_cache(maxsize=None)
def _graphql_url(catalog_host: str) -> str:
    response = requests.get(f"https://{catalog_host}/config.json", timeout=10)
    response.raise_for_status()
    return response.json()["registryUrl"].rstrip("/") + "/graphql"


class Registry:
    """Calls the stack's registry as the user who owns ``api_key``."""

    def __init__(self, catalog_host: str, api_key: str):
        self.catalog_host = catalog_host
        self.api_key = api_key

    def _query(self, query: str, variables: Dict[str, Any]) -> Dict[str, Any]:
        response = requests.post(
            _graphql_url(self.catalog_host),
            json={"query": query, "variables": variables},
            headers={"Authorization": f"Bearer {self.api_key}"},
            timeout=30,
        )
        response.raise_for_status()
        body = response.json()
        if body.get("errors"):
            raise RuntimeError(body["errors"][0].get("message", "GraphQL error"))
        return body["data"]

    def get_lock(self, bucket: str, name: str) -> Optional[Dict[str, Any]]:
        """Return the package's lock (``hash``, ``lockedAt``), or None if it is unlocked."""
        package = self._query(LOCK_QUERY, {"bucket": bucket, "name": name})["package"]
        return (package or {}).get("lock")

    def lock(self, bucket: str, name: str, top_hash: str, reason: str) -> LockState:
        """Lock the package at ``top_hash``; return the new lock, or the registry's error."""
        result = self._query(LOCK_MUTATION, {"bucket": bucket, "name": name, "hash": top_hash, "reason": reason})[
            "packageLock"
        ]
        if result["__typename"] == "PackageLock":
            return LockState(lock={"hash": result["hash"], "lockedAt": result.get("lockedAt")})
        error = (result.get("errors") or [result])[0]
        return LockState(error=f"{error.get('name') or result['__typename']}: {error.get('message', '')}")


def lock_sealed_revision(registry: Registry, bucket: str, name: str, top_hash: str, display_id: str) -> LockState:
    """Lock a sealed entry package at its sealed revision.

    Returns the package's lock afterwards, with why it is not at that revision when it is not.
    Never raises: the seal stands whether or not the lock lands.
    """
    try:
        lock = registry.get_lock(bucket, name)
        if lock and lock["hash"] == top_hash:
            state = LockState(lock=lock)
        elif lock:
            # The webhook cannot unlock (admin-only), so a reseal leaves the earlier lock in place.
            state = LockState(lock=lock, error=f"locked at an earlier revision {lock['hash'][:7]}")
        else:
            state = registry.lock(bucket, name, top_hash, f"Benchling review accepted: {display_id}")
    except Exception as exc:
        state = LockState(error=str(exc) or type(exc).__name__)
    if state.error is None:
        logger.info("Locked sealed package", package_name=name, top_hash=top_hash)
    elif state.error.startswith(("LatestMoved:", "locked at an earlier revision")):
        logger.warning("Sealed revision not locked", package_name=name, error=state.error)
    else:
        logger.error("Package lock failed; package stays sealed", package_name=name, error=state.error)
    return state
