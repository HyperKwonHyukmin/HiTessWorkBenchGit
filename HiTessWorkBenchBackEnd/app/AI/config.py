"""프로젝트 전역 설정."""

from pathlib import Path

# ── 경로 ──
BASE_DIR = Path(__file__).resolve().parent
# REPORTS_DIR = BASE_DIR / "reports_data"
REPORTS_DIR = Path(r"C:\Users\HHI\Desktop\reports_data")
VECTORSTORE_DIR = BASE_DIR / "vectorstore"

# ── Ollama 모델 ──
OLLAMA_BASE_URL = "http://localhost:11434"
LLM_MODEL = "qwen2.5:7b"               # 답변 생성용 LLM (한국어 우수)
EMBEDDING_MODEL = "bge-m3"             # 임베딩 모델 (다국어 최강)

# ── 청킹 ──
# 부모 청크: LLM에 전달되는 큰 단위
PARENT_CHUNK_SIZE = 2000
PARENT_CHUNK_OVERLAP = 300
# 자식 청크: 벡터 검색에 사용되는 작은 단위
CHILD_CHUNK_SIZE = 500
CHILD_CHUNK_OVERLAP = 100

# ── 검색 ──
RETRIEVER_K = 10       # 상위 K개 자식 청크 검색 → 부모 청크로 확장
MULTI_QUERY_COUNT = 3  # Multi-Query: 질문 변형 개수
BM25_WEIGHT = 0.3      # 하이브리드 검색: BM25 가중치 (0.0~1.0)
VECTOR_WEIGHT = 0.7    # 하이브리드 검색: 벡터 검색 가중치

# ── 대화 기억 ──
CHAT_HISTORY_LIMIT = 5  # 최근 N개 대화 쌍을 기억
