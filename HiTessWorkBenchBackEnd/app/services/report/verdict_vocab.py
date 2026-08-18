"""판정 낱말 — 어댑터와 렌더러가 함께 쓰는 단일 출처.

어댑터는 이 낱말로 문자열에서 판정을 읽어 내고, 렌더러는 같은 낱말로 표의 실패 행을
강조한다. 두 곳에 따로 적어 두면 조용히 어긋난다 — 어댑터가 '부적합'을 불합격으로
읽는데 렌더러는 그 행을 강조하지 않는 식이다. 그러면 '실패 행이 눈에 걸려야 한다'는
약속이 어휘 불일치만으로 깨지고, 아무 테스트도 깨지지 않는다.

여기에는 **낱말만** 둔다. 부정어·부정 표현처럼 문장을 해석하는 규칙은 어댑터의 몫이다.
"""

NEGATIVE_TOKENS: frozenset[str] = frozenset({
    "fail", "failed", "ng", "nok", "불합격", "부적합",
})
WARNING_TOKENS: frozenset[str] = frozenset({
    "warn", "warning", "경고", "주의",
})
POSITIVE_TOKENS: frozenset[str] = frozenset({
    "ok", "pass", "passed", "safe", "합격", "적합",
})
