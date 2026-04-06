"""문서 로드 → 청킹 → FAISS 벡터 DB 적재 스크립트.

하이브리드 PDF 로더:
  - 텍스트 PDF → PyMuPDF로 직접 추출
  - 표 데이터 → pdfplumber로 표 구조 보존 추출
  - 이미지 PDF → PyMuPDF로 이미지 추출 → Tesseract OCR

Parent Document 방식:
  - 부모 청크(2000자): LLM에 전달되어 충분한 문맥 제공
  - 자식 청크(500자): 벡터 검색에 사용되어 정밀한 매칭

BM25 인덱스:
  - 키워드 기반 검색을 위한 BM25 인덱스도 함께 생성

사용법:
    python ingest.py
"""

import json
import sys
import os
import pickle
from pathlib import Path

# Windows 콘솔 인코딩 문제 방지
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

import fitz  # PyMuPDF
import pdfplumber
from langchain_community.document_loaders import (
    Docx2txtLoader,
    TextLoader,
)
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_ollama import OllamaEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from rank_bm25 import BM25Okapi

from .config import (
    REPORTS_DIR,
    VECTORSTORE_DIR,
    OLLAMA_BASE_URL,
    EMBEDDING_MODEL,
    PARENT_CHUNK_SIZE,
    PARENT_CHUNK_OVERLAP,
    CHILD_CHUNK_SIZE,
    CHILD_CHUNK_OVERLAP,
)

# Tesseract 경로 (설치된 경우) — 환경변수 TESSERACT_CMD로 오버라이드 가능
TESSERACT_CMD = os.environ.get("TESSERACT_CMD", r"C:\Program Files\Tesseract-OCR\tesseract.exe")

# 부모 청크 저장 경로
PARENT_STORE_PATH = VECTORSTORE_DIR / "parent_docs.json"
# BM25 인덱스 저장 경로
BM25_INDEX_PATH = VECTORSTORE_DIR / "bm25_index.pkl"
# 문서 요약 저장 경로
DOC_SUMMARIES_PATH = VECTORSTORE_DIR / "doc_summaries.json"

# 텍스트가 이 글자수 미만이면 이미지 기반 페이지로 판단
MIN_TEXT_LENGTH = 30


def ocr_page(page) -> str:
    """이미지 기반 페이지에서 OCR로 텍스트를 추출한다."""
    try:
        import pytesseract
        from PIL import Image
        import io

        pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD

        # 페이지를 고해상도 이미지로 변환
        pix = page.get_pixmap(dpi=300)
        img = Image.open(io.BytesIO(pix.tobytes("png")))

        # OCR (영어 + 가용 언어)
        langs = "eng"
        try:
            available = pytesseract.get_languages()
            if "kor" in available:
                langs = "kor+eng"
        except Exception:
            pass

        text = pytesseract.image_to_string(img, lang=langs)
        return text.strip()
    except Exception:
        return ""


def extract_tables_from_pdf(file_path: Path) -> dict[int, str]:
    """pdfplumber로 PDF의 표를 마크다운 형식으로 추출한다.

    Returns:
        {page_index: table_markdown_text} 딕셔너리
    """
    tables_by_page = {}
    try:
        pdf_bytes = file_path.read_bytes()
        with pdfplumber.open(file_path) as pdf:
            for i, page in enumerate(pdf.pages):
                tables = page.extract_tables()
                if not tables:
                    continue

                table_texts = []
                for table in tables:
                    if not table or len(table) < 2:
                        continue

                    # 마크다운 표로 변환
                    md_rows = []
                    for row_idx, row in enumerate(table):
                        cells = [str(c).strip() if c else "" for c in row]
                        md_rows.append("| " + " | ".join(cells) + " |")
                        if row_idx == 0:
                            md_rows.append("|" + "|".join(["---"] * len(cells)) + "|")

                    if md_rows:
                        table_texts.append("\n".join(md_rows))

                if table_texts:
                    tables_by_page[i] = "\n\n".join(table_texts)
    except Exception as e:
        print(f"    ⚠ 표 추출 경고 ({file_path.name}): {e}")

    return tables_by_page


def load_pdf_pymupdf(file_path: Path) -> tuple[list[Document], str]:
    """PyMuPDF + pdfplumber로 PDF를 로드한다.

    텍스트가 없는 페이지는 OCR을 시도하고, 표 데이터는 마크다운으로 보존한다.
    """
    docs = []
    pdf_bytes = file_path.read_bytes()
    pdf = fitz.open(stream=pdf_bytes, filetype="pdf")
    ocr_pages = 0
    text_pages = 0
    table_pages = 0

    # 표 데이터 추출
    tables_by_page = extract_tables_from_pdf(file_path)

    for i in range(len(pdf)):
        page = pdf[i]
        text = page.get_text().strip()

        if len(text) < MIN_TEXT_LENGTH:
            ocr_text = ocr_page(page)
            if ocr_text:
                text = ocr_text
                ocr_pages += 1
            if len(text) < MIN_TEXT_LENGTH:
                # 표만 있는 페이지일 수 있음
                if i in tables_by_page:
                    text = tables_by_page[i]
                    table_pages += 1
                else:
                    continue
        else:
            text_pages += 1

        # 표 데이터가 있으면 텍스트 뒤에 추가
        if i in tables_by_page and i not in []:
            table_md = tables_by_page[i]
            # 이미 텍스트에 표 내용이 포함되어 있지 않으면 추가
            if len(table_md) > 50 and table_md[:30] not in text:
                text += f"\n\n[표 데이터]\n{table_md}"
                table_pages += 1

        docs.append(Document(
            page_content=text,
            metadata={
                "source_file": file_path.name,
                "page": i,
            },
        ))

    pdf.close()

    method = []
    if text_pages > 0:
        method.append(f"텍스트 {text_pages}p")
    if ocr_pages > 0:
        method.append(f"OCR {ocr_pages}p")
    if table_pages > 0:
        method.append(f"표 {table_pages}p")

    return docs, " + ".join(method) if method else "빈 문서"


def load_documents(data_dir: Path):
    """reports_data 폴더의 모든 지원 파일을 로드한다."""
    docs = []
    files = list(data_dir.rglob("*"))
    supported = [f for f in files if f.suffix.lower() in (".pdf", ".docx", ".txt")]

    if not supported:
        print(f"[!] '{data_dir}' 에 지원되는 문서가 없습니다.")
        sys.exit(1)

    for file_path in supported:
        try:
            ext = file_path.suffix.lower()
            if ext == ".pdf":
                loaded, method = load_pdf_pymupdf(file_path)
                info = f"{len(loaded)} page(s), {method}"
            elif ext == ".docx":
                loaded = Docx2txtLoader(str(file_path)).load()
                for doc in loaded:
                    doc.metadata["source_file"] = file_path.name
                info = f"{len(loaded)} section(s)"
            elif ext == ".txt":
                loaded = TextLoader(str(file_path), encoding="utf-8").load()
                for doc in loaded:
                    doc.metadata["source_file"] = file_path.name
                info = f"{len(loaded)} section(s)"
            else:
                continue

            docs.extend(loaded)
            print(f"  ✔ {file_path.name}  ({info})")
        except Exception as e:
            print(f"  ✘ {file_path.name} 로드 실패: {e}")

    return docs


def split_parent_child(docs):
    """부모-자식 청크를 생성한다."""
    parent_splitter = RecursiveCharacterTextSplitter(
        chunk_size=PARENT_CHUNK_SIZE,
        chunk_overlap=PARENT_CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    child_splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHILD_CHUNK_SIZE,
        chunk_overlap=CHILD_CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", " ", ""],
    )

    parent_chunks = parent_splitter.split_documents(docs)
    parent_store = {}
    child_chunks = []

    for i, parent in enumerate(parent_chunks):
        parent_id = f"parent_{i}"
        parent_store[parent_id] = {
            "text": parent.page_content,
            "metadata": parent.metadata,
        }
        children = child_splitter.split_documents([parent])
        for child in children:
            child.metadata["parent_id"] = parent_id
        child_chunks.extend(children)

    return parent_store, child_chunks


def build_bm25_index(child_chunks):
    """자식 청크로 BM25 인덱스를 생성한다."""
    # 한국어 형태소 분석 대신 공백+문자 단위 토큰화
    corpus = []
    for chunk in child_chunks:
        # 간단한 토큰화: 공백 분리 + 2글자 이상
        tokens = [t for t in chunk.page_content.split() if len(t) >= 2]
        corpus.append(tokens)

    bm25 = BM25Okapi(corpus)

    # BM25 인덱스와 메타데이터 저장
    bm25_data = {
        "bm25": bm25,
        "corpus": corpus,
        "metadata": [chunk.metadata for chunk in child_chunks],
        "texts": [chunk.page_content for chunk in child_chunks],
    }

    with open(BM25_INDEX_PATH, "wb") as f:
        pickle.dump(bm25_data, f)

    return bm25


def generate_doc_summaries(docs):
    """문서별로 앞부분 텍스트를 기반으로 요약 메타데이터를 생성한다."""
    from collections import defaultdict

    # 파일별로 페이지 텍스트를 모음
    file_texts = defaultdict(list)
    for doc in docs:
        src = doc.metadata.get("source_file", "unknown")
        file_texts[src].append(doc.page_content)

    summaries = {}
    for src, texts in file_texts.items():
        # 앞 3페이지의 텍스트를 합쳐서 요약 대용으로 사용
        combined = "\n".join(texts[:3])[:2000]
        summaries[src] = {
            "preview": combined,
            "page_count": len(texts),
            "total_chars": sum(len(t) for t in texts),
        }

    with open(DOC_SUMMARIES_PATH, "w", encoding="utf-8") as f:
        json.dump(summaries, f, ensure_ascii=False, indent=2)

    return summaries


def build_vectorstore(child_chunks, parent_store):
    """자식 청크를 벡터 DB에, 부모 청크를 JSON에 저장한다."""
    embeddings = OllamaEmbeddings(
        model=EMBEDDING_MODEL,
        base_url=OLLAMA_BASE_URL,
    )
    vectorstore = FAISS.from_documents(child_chunks, embeddings)
    vectorstore.save_local(str(VECTORSTORE_DIR))

    with open(PARENT_STORE_PATH, "w", encoding="utf-8") as f:
        json.dump(parent_store, f, ensure_ascii=False, indent=2)

    return vectorstore


def main():
    print(f"\n[1/5] 문서 로드 중… ({REPORTS_DIR})")
    print(f"      (PyMuPDF + pdfplumber 표 추출 + OCR 하이브리드 모드)\n")
    docs = load_documents(REPORTS_DIR)

    # 빈 문서 필터링
    docs = [d for d in docs if len(d.page_content.strip()) >= MIN_TEXT_LENGTH]
    print(f"\n      총 {len(docs)}개 유효 페이지 로드 완료.\n")

    if not docs:
        print("[!] 유효한 텍스트가 추출된 문서가 없습니다.")
        sys.exit(1)

    print(f"[2/5] 부모-자식 청킹 중…")
    print(f"      부모: {PARENT_CHUNK_SIZE}자 / 자식: {CHILD_CHUNK_SIZE}자")
    parent_store, child_chunks = split_parent_child(docs)
    print(f"      부모 {len(parent_store)}개 / 자식 {len(child_chunks)}개 생성.\n")

    print(f"[3/5] 임베딩 & 벡터 DB 저장 중… (모델={EMBEDDING_MODEL})")
    build_vectorstore(child_chunks, parent_store)
    print(f"      저장 완료 → {VECTORSTORE_DIR}\n")

    print(f"[4/5] BM25 키워드 인덱스 생성 중…")
    build_bm25_index(child_chunks)
    print(f"      저장 완료 → {BM25_INDEX_PATH}\n")

    print(f"[5/5] 문서 요약 인덱스 생성 중…")
    summaries = generate_doc_summaries(docs)
    for src, info in summaries.items():
        print(f"  ✔ {src}  ({info['page_count']}p, {info['total_chars']:,}자)")
    print(f"      저장 완료 → {DOC_SUMMARIES_PATH}\n")

    print(f"완료!")
    print(f"  자식 청크 → FAISS (벡터 검색용)")
    print(f"  자식 청크 → BM25 (키워드 검색용)")
    print(f"  부모 청크 → parent_docs.json (LLM 문맥용)")
    print(f"  문서 요약 → doc_summaries.json (검색 보조용)\n")


if __name__ == "__main__":
    main()
