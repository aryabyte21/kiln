"""Unit tests for ``_topo_sort`` (Kahn's algorithm) in graph_flow.

This is the highest-stakes piece of code in the chat backend: a wrong
topological order means agents run with stale or missing dependencies
and silently produce incorrect answers. Cover linear chains, diamonds,
parallel branches, single nodes, empty graphs, and the cycle edge case.
"""

from __future__ import annotations

import pytest

from kiln_chat_backend.graph_flow import _topo_sort


def _node(nid: str) -> dict:
    """Build a minimal DAG node dict — only ``id`` is read by _topo_sort."""
    return {"id": nid, "role": "test", "task": "noop", "tools": []}


def test_linear_chain() -> None:
    """A → B → C must come out as [A, B, C]."""
    nodes = [_node("A"), _node("B"), _node("C")]
    edges = [["A", "B"], ["B", "C"]]
    assert _topo_sort(nodes, edges) == ["A", "B", "C"]


def test_diamond_dag() -> None:
    """Diamond: A → B, A → C, B → D, C → D.

    A must come first, D must come last, B and C in any order between.
    """
    nodes = [_node("A"), _node("B"), _node("C"), _node("D")]
    edges = [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"]]

    result = _topo_sort(nodes, edges)
    assert len(result) == 4
    assert result[0] == "A"
    assert result[-1] == "D"
    assert set(result[1:3]) == {"B", "C"}


def test_parallel_branches_no_edges() -> None:
    """Two unconnected nodes — both must appear, order is implementation-defined."""
    nodes = [_node("A"), _node("B")]
    edges: list[list[str]] = []
    assert sorted(_topo_sort(nodes, edges)) == ["A", "B"]


def test_single_node() -> None:
    nodes = [_node("only")]
    assert _topo_sort(nodes, []) == ["only"]


def test_empty_graph() -> None:
    assert _topo_sort([], []) == []


def test_cycle_returns_partial_result() -> None:
    """A → B → A is a cycle. Kahn's algorithm cannot resolve it.

    The current implementation returns a partial result (nodes that are
    part of the cycle have in_degree > 0 forever and never enter the
    queue). The CALLER should detect this via ``len(result) != len(nodes)``.
    Pinning that contract here so a future "fix" can't silently change it.
    """
    nodes = [_node("A"), _node("B")]
    edges = [["A", "B"], ["B", "A"]]

    result = _topo_sort(nodes, edges)
    assert len(result) < len(nodes), (
        "Cycle should produce a partial result so the caller can detect it"
    )


def test_complex_dag_dependency_order() -> None:
    """Five-node DAG: every edge must be respected (src precedes dst).

    Tests that the algorithm holds the invariant for an arbitrary DAG,
    not just hand-tuned shapes.
    """
    nodes = [_node("a"), _node("b"), _node("c"), _node("d"), _node("e")]
    edges = [
        ["a", "c"],
        ["b", "c"],
        ["c", "d"],
        ["c", "e"],
        ["d", "e"],
    ]

    result = _topo_sort(nodes, edges)
    assert len(result) == 5
    pos = {nid: i for i, nid in enumerate(result)}
    for src, dst in edges:
        assert pos[src] < pos[dst], f"Edge {src}->{dst} violated: {result}"
