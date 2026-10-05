from unittest.mock import Mock, patch

import pytest

from src.registry import Registry, _graphql_url, lock_sealed_revision

HASH = "b07c91cf" * 8


@pytest.fixture
def registry():
    registry = Mock(spec=Registry)
    registry.get_lock.return_value = None
    registry.lock.return_value = None
    return registry


def _lock(registry):
    return lock_sealed_revision(registry, "lab-bucket", "benchling/EXP1", HASH, "EXP1")


def test_locks_sealed_revision_with_reason(registry):
    assert _lock(registry) is None
    registry.lock.assert_called_once_with("lab-bucket", "benchling/EXP1", HASH, "Benchling review accepted: EXP1")


def test_skips_when_already_locked_at_sealed_revision(registry):
    registry.get_lock.return_value = {"hash": HASH, "lockedAt": "2026-10-05T12:00:00+00:00"}

    assert _lock(registry) is None
    registry.lock.assert_not_called()


def test_reports_lock_left_at_earlier_revision(registry):
    registry.get_lock.return_value = {"hash": "0" * 64, "lockedAt": "2026-10-05T12:00:00+00:00"}

    assert _lock(registry) == "locked at an earlier revision 0000000"
    registry.lock.assert_not_called()


@pytest.mark.parametrize(
    "error",
    [
        "LatestMoved: Package 'benchling/EXP1' has moved to abc; lock the current revision",
        "PackageLockPolicyTooLarge: Locking this package would grow the lock policy past IAM's 6144 characters",
        "Forbidden",
    ],
)
def test_returns_registry_error_without_retrying(registry, error):
    registry.lock.return_value = error

    assert _lock(registry) == error
    registry.lock.assert_called_once()


def test_returns_transport_error_instead_of_raising(registry):
    registry.get_lock.side_effect = ConnectionError("registry unreachable")

    assert _lock(registry) == "registry unreachable"


def _response(body):
    return Mock(json=Mock(return_value=body), raise_for_status=Mock())


def test_registry_authenticates_with_api_key_against_catalog_registry():
    _graphql_url.cache_clear()
    config = _response({"registryUrl": "https://registry.example.com/"})
    result = _response({"data": {"packageLock": {"__typename": "PackageLock", "hash": HASH, "lockedAt": "x"}}})
    with patch("src.registry.requests") as requests:
        requests.get.return_value = config
        requests.post.return_value = result

        assert Registry("catalog.example.com", "qk_secret").lock("b", "n", HASH, "r") is None

    requests.get.assert_called_once_with("https://catalog.example.com/config.json", timeout=10)
    url = requests.post.call_args.args[0]
    assert url == "https://registry.example.com/graphql"
    assert requests.post.call_args.kwargs["headers"] == {"Authorization": "Bearer qk_secret"}
    assert requests.post.call_args.kwargs["json"]["variables"]["hash"] == HASH


@pytest.mark.parametrize(
    "result, expected",
    [
        ({"__typename": "OperationError", "name": "LatestMoved", "message": "moved"}, "LatestMoved: moved"),
        ({"__typename": "InvalidInput", "errors": [{"name": "InvalidHash", "message": "bad"}]}, "InvalidHash: bad"),
        ({"__typename": "SomethingNew"}, "SomethingNew: "),
    ],
)
def test_registry_lock_returns_named_error(result, expected):
    with patch("src.registry._graphql_url", return_value="https://r/graphql"), patch("src.registry.requests") as rq:
        rq.post.return_value = _response({"data": {"packageLock": result}})

        assert Registry("c", "k").lock("b", "n", HASH, "r") == expected


def test_registry_raises_on_graphql_errors():
    with patch("src.registry._graphql_url", return_value="https://r/graphql"), patch("src.registry.requests") as rq:
        rq.post.return_value = _response({"errors": [{"message": "Forbidden"}], "data": None})

        with pytest.raises(RuntimeError, match="Forbidden"):
            Registry("c", "k").get_lock("b", "n")
