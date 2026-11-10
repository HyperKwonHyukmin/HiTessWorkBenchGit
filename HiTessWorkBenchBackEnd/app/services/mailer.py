"""사내 메일 발송(SMTP) — 등록한 PC 로그인의 확인 코드 메일용 (2026-11-10).

설정은 `.env` 에서만 읽는다(비밀번호를 코드·로그에 남기지 않는다):
- SMTP_HOST (예 exmail.hhi.co.kr) · SMTP_PORT (기본 25) · SMTP_FROM (보내는 주소)
- SMTP_USER · SMTP_PASSWORD (사내 메일 서버가 인증을 요구할 때)
- SMTP_STARTTLS=1 (서버가 요구할 때만)
SMTP_HOST·SMTP_FROM 이 없으면 '설정 안 됨' — 부르는 쪽이 다른 확인 방법(관리자 승인)으로 넘어간다.
"""
from __future__ import annotations

import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

SEND_TIMEOUT_SEC = 15


def mail_configured() -> bool:
    return bool((os.getenv("SMTP_HOST") or "").strip() and (os.getenv("SMTP_FROM") or "").strip())


def send_mail(to: str, subject: str, body: str) -> None:
    """한 통 보낸다. 실패하면 예외(부르는 쪽이 처리). 비밀번호는 예외 문구에도 담기지 않는다."""
    host = (os.getenv("SMTP_HOST") or "").strip()
    sender = (os.getenv("SMTP_FROM") or "").strip()
    if not host or not sender:
        raise RuntimeError("mail_not_configured")
    port = int((os.getenv("SMTP_PORT") or "25").strip() or 25)
    user = (os.getenv("SMTP_USER") or "").strip()
    password = os.getenv("SMTP_PASSWORD") or ""

    msg = EmailMessage()
    msg["From"] = formataddr(("Hi-TESS WorkBench", sender))
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)

    with smtplib.SMTP(host, port, timeout=SEND_TIMEOUT_SEC) as smtp:
        smtp.ehlo()
        if (os.getenv("SMTP_STARTTLS") or "").strip() == "1":
            smtp.starttls(context=ssl.create_default_context())  # 메일 서버 인증서를 확인한다
            smtp.ehlo()
        if user:
            smtp.login(user, password)
        smtp.send_message(msg)


def mask_email(address: str) -> str:
    """'a590063@hd.com' → 'a5*****@hd.com' — 화면에 어느 메일함인지 알 만큼만."""
    local, sep, domain = (address or "").partition("@")
    if not sep:
        return ""
    keep = local[:2]
    return f"{keep}{'*' * max(len(local) - len(keep), 3)}@{domain}"
