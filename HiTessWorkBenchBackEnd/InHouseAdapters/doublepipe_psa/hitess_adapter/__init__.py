"""hitess_adapter — 이중관 PSA 엔진의 WorkBench 어댑터 계층.

연구원이 개발하는 오리지널 엔진(`InHouseProgram/DoublePipe/Piping Stress Analysis for all
load cases/`)을 **한 줄도 수정하지 않고** WorkBench 백엔드에서 무인 실행할 수 있게 만든다.

- `shims/`  : 실행 환경 차이(DRM·인코딩·openpyxl·Abaqus 프롬프트)를 런타임에 주입
- `cli.py`  : 엔진의 Main.py 를 대체하는 CLI/파이프라인 (기존 exe 와 동일한 인자 규약)
- `engine.py`: 엔진 심볼 import + 계약 검증(드리프트 조기 감지)
- `patches.py`/`prep.py` : shim 으로 못 뚫는 엔진 로직 fix 를 빌드 스테이징 사본에만 적용
"""
__version__ = "1.0.0"
