"""서버 감시·자동 복구 공용 모듈.

app/(FastAPI 앱) 과 분리한다. 감시자는 uvicorn 바깥에서 돌아야 하므로
app/ 을 import 하면 FastAPI·SQLAlchemy 초기화가 딸려와 감시 자체가 무거워진다.
"""
