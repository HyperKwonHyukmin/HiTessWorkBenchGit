from app.services.groupmoduleunit_service import transform_to_step1


def _model(orphan_ids, isolated_ids):
    return {
        "nodes": [{"id": node_id, "x": 0, "y": 0, "z": 0} for node_id in {1, *orphan_ids, *isolated_ids}],
        "healthMetrics": {
            "issues": {
                "orphanNodeCount": len(orphan_ids),
                "orphanNodeIds": orphan_ids,
                "isolatedNodeCount": len(isolated_ids),
                "disconnectedGroupCount": len(isolated_ids),
            }
        },
        "connectivity": {
            "groupCount": 1 + len(isolated_ids),
            "isolatedNodeCount": len(isolated_ids),
            "isolatedNodeIds": isolated_ids,
        },
    }


def test_pure_orphan_grids_warn_but_do_not_block_validation():
    result = transform_to_step1(_model([1371, 1408], [1371, 1408]), "sample.bdf")

    assert result["status"] == "warning"
    assert result["summary"]["totalErrors"] == 0
    assert result["summary"]["totalWarnings"] == 1
    assert result["parsingSummary"]["orphanNodes"] == 2
    assert result["parsingSummary"]["isolatedNodes"] == 0
    assert result["parsingSummary"]["rawIsolatedNodes"] == 2
    assert result["parsingSummary"]["disconnectedGroupCount"] == 0
    assert result["parsingSummary"]["rawDisconnectedGroupCount"] == 2
    grid_rule = next(rule for rule in result["rulesChecked"] if rule["rule"] == "GridRule")
    assert grid_rule["status"] == "warning"
    assert grid_rule["errorCount"] == 0
    assert grid_rule["warningCount"] == 2


def test_referenced_but_isolated_grid_still_blocks_validation():
    result = transform_to_step1(_model([], [99]), "sample.bdf")

    assert result["status"] == "error"
    assert result["summary"]["totalErrors"] == 1
    assert any(
        row["severity"] == "error" and row["fieldName"] == "graph"
        for row in result["validationResults"]
    )
