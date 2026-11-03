"""F06 경고 4698 표에서 해석 실패 위치 후보 읽기 — 표 모양은 실제 F06(3454, FATAL 9050) 그대로."""
from app.services.f06_location import MAX_NODES, describe_problem_nodes, problem_nodes

TABLE = """
 *** USER WARNING MESSAGE 4698 (DCMPD)
     STATISTICS FOR DECOMPOSITION OF MATRIX KLL      .
         GRID POINT ID       DEGREE OF FREEDOM   MATRIX/FACTOR DIAGONAL RATIO        MATRIX DIAGONAL
             226                    T2                  -2.84884E+15                   6.10353E+05
             226                    T3                  -4.61361E+15                   1.65536E+04
            2093                    T3                   2.29448E+16                   6.67781E+05
            2108                    R1                   1.01280E+32                   1.01280E+07
 *** USER FATAL MESSAGE 9050 (SUBDMAP SEKRRS)
     RUN TERMINATED DUE TO EXCESSIVE PIVOT RATIOS IN MATRIX KLL.
             999                    T1                   1.00000E+40                   1.00000E+00
"""


def test_nodes_rank_by_ratio_and_table_ends_at_next_message():
    assert problem_nodes(TABLE.splitlines()) == [2108, 2093, 226]


def test_no_table_gives_no_nodes():
    assert problem_nodes(["*** USER FATAL MESSAGE 9994 (BULKIN)"]) == []


def test_node_count_is_capped():
    rows = ["GRID POINT ID       DEGREE OF FREEDOM   MATRIX/FACTOR DIAGONAL RATIO        MATRIX DIAGONAL"]
    rows += [f"  {n}  T1  1.00000E+{10 + n % 9}  1.00000E+00" for n in range(1, 60)]
    assert len(problem_nodes(rows)) == MAX_NODES


def test_describe_reads_file_and_missing_file_is_empty(tmp_path):
    f06 = tmp_path / "a.f06"
    f06.write_text(TABLE, encoding="latin-1")
    assert describe_problem_nodes(str(f06)) == " 위치 후보 절점: 2108, 2093, 226"
    assert describe_problem_nodes(str(tmp_path / "gone.f06")) == ""
