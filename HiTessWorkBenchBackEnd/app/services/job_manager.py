"""
해석 작업 큐 및 상태 관리 모듈.
ThreadPoolExecutor 기반의 동시 실행 제한과 메모리 기반 작업 상태 저장소를 제공합니다.
"""
from concurrent.futures import ThreadPoolExecutor

# 서버 사양에 맞춰 최대 동시 실행 개수를 지정합니다.
MAX_CONCURRENT_JOBS = 5
analysis_executor = ThreadPoolExecutor(max_workers=MAX_CONCURRENT_JOBS)

# 비동기 작업 진행도를 저장할 메모리 저장소
# 실제 상용 시에는 Redis로 교체하는 것이 가장 좋습니다.
job_status_store = {}
