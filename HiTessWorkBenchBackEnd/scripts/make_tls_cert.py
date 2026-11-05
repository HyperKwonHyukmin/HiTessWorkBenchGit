"""HTTPS 용 자체 인증서 만들기 — **145 서버에서 직접 실행한다** (개인 키가 서버 밖으로 나가지 않게).

    python scripts/make_tls_cert.py                       # 145 기본값(IP 10.14.42.145 + 호스트 이름)으로 만든다
    python scripts/make_tls_cert.py --ip 10.133.122.70 --dns HHIPN307900.HDShipGroup.HHI.co.kr   # 개발 PC 시험용
    python scripts/make_tls_cert.py --pins                # 이미 만든 키의 고정값(지문)만 다시 보기
    python scripts/make_tls_cert.py --renew-cert          # 만료·주소 추가 — 키는 그대로, 인증서만 새로(고정값 그대로)

만드는 것(기본 ``<백엔드>/.secrets/tls/``, git 제외):
- ``server.key`` + ``server.crt`` — 지금 쓰는 키와 인증서(RSA 2048, 유효 5년)
- ``backup.key`` — **예비 키**(인증서 없음). 앱에 지금 키와 함께 지문을 고정해 둔다.
  지금 키가 유출·분실되면 ``--from-backup`` 으로 예비 키에 인증서를 붙여 바꾼다 → 앱을 다시 배포하지 않아도 된다.
  ⚠ 예비 키는 서버와 다른 곳(개인 보관 USB 등)에도 한 벌 둘 것.

끝에 출력하는 **고정값(SPKI sha256, base64)** 은 공개 정보다 — 앱(WorkBench·실행기·HiTessMB)에 넣는다.
기존 파일이 있으면 덮어쓰지 않는다(``--force`` 로만). 키를 바꾸면 고정값이 바뀌어 앱이 연결을 거부한다.
"""
from __future__ import annotations

import argparse
import base64
import datetime
import hashlib
import ipaddress
import sys
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

DEFAULT_DIR = Path(__file__).resolve().parents[1] / ".secrets" / "tls"
DEFAULT_IPS = ["10.14.42.145"]
DEFAULT_DNS = ["HHIPW170658.HDShipGroup.HHI.co.kr"]  # 145 (2026-11-05 역방향 DNS 로 확인)


def spki_pin(public_key) -> str:
    spki = public_key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return base64.b64encode(hashlib.sha256(spki).digest()).decode()


def _write_key(path: Path, key) -> None:
    path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                       serialization.NoEncryption()))


def _load_key(path: Path):
    return serialization.load_pem_private_key(path.read_bytes(), password=None)


def build_cert(key, ips: list[str], dns: list[str], days: int) -> x509.Certificate:
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "HiTESS WorkBench"),
                      x509.NameAttribute(NameOID.ORGANIZATION_NAME, "HiTESS")])
    sans = [x509.IPAddress(ipaddress.ip_address(ip)) for ip in ips] + [x509.DNSName(d) for d in dns]
    now = datetime.datetime.now(datetime.timezone.utc)
    return (x509.CertificateBuilder()
            .subject_name(name).issuer_name(name)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(minutes=5))
            .not_valid_after(now + datetime.timedelta(days=days))
            .add_extension(x509.SubjectAlternativeName(sans), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .sign(key, hashes.SHA256()))


def print_pins(out: Path) -> None:
    print("\n앱에 고정할 값(공개 정보, SPKI sha256 base64):")
    for label, fname in (("지금 키", "server.key"), ("예비 키", "backup.key")):
        path = out / fname
        if path.is_file():
            print(f"  {label:6} {spki_pin(_load_key(path).public_key())}")
        else:
            print(f"  {label:6} (파일 없음: {path})")
    crt = out / "server.crt"
    if crt.is_file():
        cert = x509.load_pem_x509_certificate(crt.read_bytes())
        print(f"\n인증서 유효 기간: {cert.not_valid_before_utc:%Y-%m-%d} ~ {cert.not_valid_after_utc:%Y-%m-%d}")
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        print("인증서 주소:", ", ".join(str(v) for v in san.get_values_for_type(x509.IPAddress))
              + " / " + ", ".join(san.get_values_for_type(x509.DNSName)))


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="HiTESS WorkBench HTTPS 자체 인증서")
    p.add_argument("--out", type=Path, default=DEFAULT_DIR)
    p.add_argument("--ip", action="append", help="인증서에 넣을 IP(여러 번 가능). 기본 10.14.42.145")
    p.add_argument("--dns", action="append", help="인증서에 넣을 호스트 이름(여러 번 가능)")
    p.add_argument("--days", type=int, default=5 * 365)
    p.add_argument("--renew-cert", action="store_true",
                   help="키는 그대로 두고 인증서만 다시 만든다(만료·주소 추가 — 고정값이 바뀌지 않는다)")
    p.add_argument("--force", action="store_true", help="지금 키를 새로 만든다(고정값이 바뀐다, 예비 키는 그대로)")
    p.add_argument("--from-backup", action="store_true", help="예비 키를 지금 키로 올리고 새 예비 키를 만든다")
    p.add_argument("--pins", action="store_true", help="고정값만 다시 출력")
    a = p.parse_args(argv)

    out: Path = a.out
    if a.pins:
        print_pins(out)
        return 0
    ips = a.ip or DEFAULT_IPS
    # 기본 호스트 이름은 145 것 — IP 를 직접 준 경우(다른 PC)에는 --dns 를 줄 때만 넣는다
    dns = a.dns if a.dns is not None else ([] if a.ip else DEFAULT_DNS)
    out.mkdir(parents=True, exist_ok=True)
    server_key, backup_key = out / "server.key", out / "backup.key"

    if a.renew_cert:
        if not server_key.is_file():
            print(f"지금 키가 없습니다: {server_key}", file=sys.stderr)
            return 2
        key = _load_key(server_key)
        print("지금 키로 인증서만 다시 만들었습니다(고정값 그대로).")
    elif a.from_backup:
        if not backup_key.is_file():
            print(f"예비 키가 없습니다: {backup_key}", file=sys.stderr)
            return 2
        key = _load_key(backup_key)
        if server_key.is_file():
            # 두 번째 교체 때 첫 번째 옛 키를 덮어쓰지 않게 날짜를 붙인다
            stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            server_key.replace(out / f"server.key.retired_{stamp}")
        backup_key.replace(server_key)
        _write_key(backup_key, rsa.generate_private_key(public_exponent=65537, key_size=2048))
        print("예비 키를 지금 키로 올렸습니다. 새 예비 키를 만들었으니 다음 앱 릴리스에 고정값을 갱신하세요.")
    else:
        if server_key.is_file() and not a.force:
            print(f"이미 키가 있습니다: {server_key}\n바꾸면 앱의 고정값이 맞지 않아 연결이 끊깁니다. 정말 바꾸려면 --force.",
                  file=sys.stderr)
            print_pins(out)
            return 1
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        _write_key(server_key, key)
        if not backup_key.is_file():  # 예비 키는 --force 로도 바꾸지 않는다(앱에 고정된 비상용)
            _write_key(backup_key, rsa.generate_private_key(public_exponent=65537, key_size=2048))

    cert = build_cert(key, ips, dns, a.days)
    (out / "server.crt").write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    print(f"만들었습니다: {out}")
    print_pins(out)
    print("\n다음: .env 에 HTTPS_PORT=9443 을 넣고 서버를 재시작하세요(방화벽에서 그 포트를 열어야 다른 PC 가 붙습니다).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
