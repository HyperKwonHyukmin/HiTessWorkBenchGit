"""
================================================================================
File: chain.py
Description: RAG 체인 파이프라인 (벡터+BM25 하이브리드 검색, Multi-Query, Re-ranking)
Architecture Note:
  - 예외 처리(Graceful Degradation) 추가: 벡터 DB 부재 시 500 에러 방어
  - 직렬화 안정성(Serialization Safety): Numpy float32 등 비표준 타입을 Native Python 타입으로 강제 변환
================================================================================
"""

import json
import pickle
import os
from pathlib import Path
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

from .config import (
    VECTORSTORE_DIR,
    OLLAMA_BASE_URL,
    LLM_MODEL,
    EMBEDDING_MODEL,
    RETRIEVER_K,
    MULTI_QUERY_COUNT,
    BM25_WEIGHT,
    VECTOR_WEIGHT,
    CHAT_HISTORY_LIMIT,
)

# OS 독립적이고 안전한 Path 객체 캐스팅
VECTORSTORE_PATH = Path(VECTORSTORE_DIR)
PARENT_STORE_PATH = VECTORSTORE_PATH / "parent_docs.json"
BM25_INDEX_PATH = VECTORSTORE_PATH / "bm25_index.pkl"
DOC_SUMMARIES_PATH = VECTORSTORE_PATH / "doc_summaries.json"

# ── 대화 기반 질문 재구성 프롬프트 ──
CONDENSE_PROMPT = """\
아래 대화 기록과 후속 질문을 보고, 후속 질문을 독립적인 질문으로 재구성하세요.
대화 기록의 맥락을 반영하되, 검색에 적합한 구체적 질문으로 만드세요.
재구성된 질문만 출력하세요.

대화 기록:
{chat_history}

후속 질문: {question}

재구성된 질문:"""

# ── Multi-Query 프롬프트 ──
MULTI_QUERY_PROMPT = """\
당신은 검색 질의 생성 전문가입니다.
사용자의 원래 질문을 서로 다른 관점에서 {count}가지로 변형하세요.
각 변형 질문은 원래 질문과 같은 정보를 찾되, 다른 키워드와 표현을 사용하세요.
반드시 한 줄에 하나의 질문만 출력하세요. 번호나 접두어 없이 질문만 출력합니다.

원래 질문: {question}"""

# ── 메인 답변 프롬프트 ──
SYSTEM_PROMPT = """\
[중요 규칙] 반드시 한국어(Korean)로만 답변하세요.

당신은 조선·해양 구조공학 분야의 선임 연구원 수준의 전문 어시스턴트입니다.
연구실 내부 보고서의 문맥(Context)을 기반으로 질문에 답변합니다.

## 답변 작성 규칙

1. **문맥 기반 정밀 답변**: 문맥에 포함된 구체적 수치(하중, 응력, 변위, 안전율 등), \
조건, 재료 물성, 규격, 경계 조건, 해석 결과를 **정확하게 인용**하여 답변하세요.

2. **답변 구조** (아래 형식을 반드시 따르세요):
   ### 개요
   해당 보고서/작업의 목적, 배경, 대상 구조물을 2~3문장으로 요약

   ### 주요 내용
   핵심 기술 사항을 항목별로 상세히 서술. 반드시 포함할 내용:
   - 해석/검토 조건 (하중 조건, 경계 조건, 사용 규격 등)
   - 적용된 방법론 (FEA, 수계산, 규정 기반 등)
   - 구체적 결과 수치 (응력, 변위, 안전율, 좌굴 계수 등)
   - 재료 물성 및 허용 기준

   ### 결론
   안전성 판정 결과, 주요 결론, 권고사항 등

3. **전문 용어**: 문맥에 나오는 전문 용어를 그대로 사용하세요 \
(허용응력, 좌굴, 항복강도, von Mises, 안전율, UC ratio 등).

4. **수치 표기**: 문맥의 수치를 생략하지 마세요. \
표나 비교가 가능하면 마크다운 표로 정리하세요.

5. **출처 명시**: 답변 중 특정 수치를 인용할 때 어느 보고서에서 나온 것인지 괄호로 표기하세요.

6. 문맥에 답이 없으면 "제공된 문서에서 관련 내용을 찾을 수 없습니다."라고 답하세요.
7. 문맥에 없는 내용을 추측하거나 지어내지 마세요.

Context:
{context}
"""

prompt = ChatPromptTemplate.from_messages([
    ("system", SYSTEM_PROMPT),
    ("human", "{question}"),
])


def load_parent_store() -> dict:
    if PARENT_STORE_PATH.exists():
        with open(PARENT_STORE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def load_bm25_index():
    if BM25_INDEX_PATH.exists():
        with open(BM25_INDEX_PATH, "rb") as f:
            return pickle.load(f)
    return None


def load_doc_summaries() -> dict:
    if DOC_SUMMARIES_PATH.exists():
        with open(DOC_SUMMARIES_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def load_vectorstore():
    index_file = VECTORSTORE_PATH / "index.faiss"
    if not index_file.exists():
        return None

    embeddings = OllamaEmbeddings(
        model=EMBEDDING_MODEL,
        base_url=OLLAMA_BASE_URL,
    )
    return FAISS.load_local(
        str(VECTORSTORE_PATH),
        embeddings,
        allow_dangerous_deserialization=True,
    )


def condense_question(question: str, chat_history: list[dict], llm) -> str:
    if not chat_history:
        return question

    recent = chat_history[-CHAT_HISTORY_LIMIT * 2:]
    history_text = ""
    for msg in recent:
        role = "사용자" if msg["role"] == "user" else "AI"
        content = msg["content"][:200] if msg["role"] == "assistant" else msg["content"]
        history_text += f"{role}: {content}\n"

    condense_chain = (
        ChatPromptTemplate.from_messages([("human", CONDENSE_PROMPT)])
        | llm
        | StrOutputParser()
    )

    condensed = condense_chain.invoke({
        "chat_history": history_text,
        "question": question,
    })
    return condensed.strip()


def generate_multi_queries(question: str, llm) -> list[str]:
    multi_prompt = ChatPromptTemplate.from_messages([
        ("human", MULTI_QUERY_PROMPT),
    ])
    chain = multi_prompt | llm | StrOutputParser()
    result = chain.invoke({"question": question, "count": MULTI_QUERY_COUNT})

    queries = [q.strip() for q in result.strip().split("\n") if q.strip()]
    return [question] + queries[:MULTI_QUERY_COUNT]


def bm25_search(query: str, bm25_data: dict, k: int = 10) -> list[tuple[int, float]]:
    tokens = [t for t in query.split() if len(t) >= 2]
    if not tokens:
        return []

    bm25 = bm25_data["bm25"]
    scores = bm25.get_scores(tokens)

    top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:k]
    return [(i, float(scores[i])) for i in top_indices if scores[i] > 0]


def retrieve_parent_docs(
        question: str,
        vectorstore,
        parent_store: dict,
        k: int = RETRIEVER_K,
        llm=None,
        chat_history: list[dict] | None = None,
        bm25_data: dict | None = None,
        target_document: str = "all",
):
    if not vectorstore:
        return []

    search_question = question
    if llm and chat_history:
        search_question = condense_question(question, chat_history, llm)

    if llm:
        queries = generate_multi_queries(search_question, llm)
    else:
        queries = [search_question]

    parent_scores = {}

    for q in queries:
        results_with_scores = vectorstore.similarity_search_with_score(q, k=k * 3)

        for child, raw_score in results_with_scores:
            # ✅ [Fix 1] FAISS가 반환하는 numpy.float32를 Native Python float으로 변환
            score = float(raw_score)

            if target_document and target_document != "all":
                if child.metadata.get("source_file") != target_document:
                    continue

            parent_id = child.metadata.get("parent_id")
            if parent_id and parent_id in parent_store:
                relevance = 1.0 / (1.0 + score)
                vector_score = relevance * VECTOR_WEIGHT
                if parent_id not in parent_scores:
                    parent_scores[parent_id] = 0.0
                parent_scores[parent_id] = max(parent_scores[parent_id], vector_score)

        if bm25_data:
            bm25_results = bm25_search(q, bm25_data, k=k * 3)
            if bm25_results:
                max_bm25 = max(s for _, s in bm25_results) or 1.0
                for idx, b_score in bm25_results:
                    metadata = bm25_data["metadata"][idx]

                    if target_document != "all" and metadata.get("source_file") != target_document:
                        continue

                    parent_id = metadata.get("parent_id")
                    if parent_id and parent_id in parent_store:
                        norm_score = (b_score / max_bm25) * BM25_WEIGHT
                        if parent_id not in parent_scores:
                            parent_scores[parent_id] = 0.0
                        parent_scores[parent_id] += norm_score

    sorted_parents = sorted(parent_scores.items(), key=lambda x: x[1], reverse=True)

    max_score = sorted_parents[0][1] if sorted_parents else 1.0
    scale_factor = 1.0 if max_score <= 1.0 else (1.0 / max_score)

    max_parents = max(k // 2, 5)
    parent_docs = []

    for parent_id, score in sorted_parents[:max_parents]:
        doc = parent_store[parent_id].copy()

        # ✅ [Fix 2] 최종 스코어 계산 후 다시 한 번 명확하게 Native float 형으로 바인딩
        normalized_score = float(min(score * scale_factor, 0.99))
        doc["relevance_score"] = float(round(normalized_score, 4))

        # ✅ [Fix 3] Metadata 내에 숨어있는 Numpy 타입 (예: page 번호의 int64 등) 일괄 정제
        if "metadata" in doc:
            for key, val in doc["metadata"].items():
                if hasattr(val, "item"):  # Numpy 스칼라 객체인지 확인
                    doc["metadata"][key] = val.item()

        parent_docs.append(doc)

    return parent_docs


def format_parent_docs(parent_docs: list[dict]) -> str:
    parts = []
    for doc in parent_docs:
        source = doc["metadata"].get("source_file", "unknown")
        page = doc["metadata"].get("page", "")
        loc = f"{source}" + (f" (p.{page+1})" if isinstance(page, int) else "")
        parts.append(f"[출처: {loc}]\n{doc['text']}")
    return "\n\n---\n\n".join(parts)


def get_rag_chain():
    vectorstore = load_vectorstore()

    if not vectorstore:
        raise FileNotFoundError("학습된 지식 DB가 없습니다. 먼저 [지식 DB 업데이트] 버튼을 눌러 문서를 학습해주세요.")

    parent_store = load_parent_store()
    bm25_data = load_bm25_index()
    doc_summaries = load_doc_summaries()

    llm = ChatOllama(
        model=LLM_MODEL,
        base_url=OLLAMA_BASE_URL,
        temperature=0.1,
        num_ctx=16384,
    )

    return {
        "vectorstore": vectorstore,
        "parent_store": parent_store,
        "bm25_data": bm25_data,
        "doc_summaries": doc_summaries,
        "llm": llm,
        "prompt": prompt,
    }


def query(question: str, chat_history: list[dict] = None, target_document: str = "all"):
    """
    사용자의 질문을 처리하고 답변을 반환합니다.
    """
    try:
        components = get_rag_chain()
    except FileNotFoundError as e:
        return f"⚠️ **안내**: {str(e)}", []
    except Exception as sys_e:
        return f"⚠️ **시스템 오류**: 검색 모듈 초기화 중 문제가 발생했습니다. ({str(sys_e)})", []

    vs = components["vectorstore"]
    ps = components["parent_store"]
    bm25 = components["bm25_data"]
    llm = components["llm"]

    parent_docs = retrieve_parent_docs(
        question, vs, ps, llm=llm, bm25_data=bm25, chat_history=chat_history, target_document=target_document
    )

    context = format_parent_docs(parent_docs)
    messages = prompt.format_messages(context=context, question=question)

    try:
        answer = llm.invoke(messages).content
    except Exception as llm_e:
        return f"⚠️ **LLM 서버 접속 지연**: 답변을 생성할 수 없습니다. Ollama 서버 상태를 확인해주세요. ({str(llm_e)})", []

    return answer, parent_docs