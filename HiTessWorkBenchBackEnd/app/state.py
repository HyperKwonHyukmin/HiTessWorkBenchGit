"""
서버 공유 인메모리 상태.
서버 재시작 시 초기화됩니다.
"""

# 유지보수 모드 플래그 — True 시 비관리자 로그인 차단
server_state = {
    "maintenance_mode": False
}
