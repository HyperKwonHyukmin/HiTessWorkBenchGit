"""Abaqus 호출용 subprocess shim.

엔진의 `Head_for_FuelLine_ASME_B313_v2018.HeadClass_01.Abaqus_Run()` 은
`abaqus job=<LC> cpus=2 int` 를 shell 문자열로 Popen 한다. WorkBench 무인 실행에서는
여기에 두 가지 보정이 필요하다.

1. **인코딩**: cmd.exe 와 Abaqus 런처는 UTF-8 이 아니라 콘솔/OEM 코드페이지(한국어
   Windows 는 cp949)로 출력한다. `encoding='utf-8'` 로 고정 디코딩하면 한글 바이트가
   U+FFFD 로 치환되고, 이후 그 문자열을 print() 하는 단계에서 콘솔이 다시 인코딩하지
   못해 파이프라인이 죽는다(2026-07 exe 전환 시 실측). 로케일 기본 인코딩으로 교정한다.

2. **`ask_delete=OFF`**: 같은 폴더에서 재실행하면 Abaqus 가 기존 결과 파일(.odb/.dat 등)
   덮어쓰기 확인을 물어보고, 무인 실행에서는 그대로 'exited with errors' 가 된다.

두 보정 모두 **`abaqus` 로 시작하는 shell 명령에만** 적용해, 백엔드/어댑터 자신의 다른
subprocess 사용에는 영향이 없게 한다.

(엔진 Head_for_FuelLine_ASME_B313_v2018.py 에 직접 넣어 두었던 개조를 대체한다.)
"""
import locale
import re
import subprocess

_ABAQUS_CMD_RE = re.compile(r"^\s*abaqus\s", re.IGNORECASE)
_INT_TAIL_RE = re.compile(r"\s+int\s*$", re.IGNORECASE)

_installed = False
_orig_popen_init = None


def is_abaqus_command(args):
    return isinstance(args, str) and bool(_ABAQUS_CMD_RE.match(args))


def rewrite_command(args):
    """abaqus 명령에 ask_delete=OFF 를 주입한다(이미 있으면 그대로)."""
    if not is_abaqus_command(args) or "ask_delete" in args.lower():
        return args
    # 'int'(interactive) 는 마지막에 오는 것이 관례라 그 앞에 끼워 넣는다.
    match = _INT_TAIL_RE.search(args)
    if match:
        return args[: match.start()] + " ask_delete=OFF" + args[match.start():]
    return args + " ask_delete=OFF"


def fix_encoding(args, kwargs):
    """abaqus 명령에 한해 utf-8 고정 디코딩을 로케일 인코딩으로 교정한다."""
    if is_abaqus_command(args) and str(kwargs.get("encoding", "")).lower() in ("utf-8", "utf8"):
        kwargs = dict(kwargs)
        kwargs["encoding"] = locale.getpreferredencoding(False)
    return kwargs


def install():
    global _installed, _orig_popen_init
    if _installed:
        return
    if getattr(subprocess.Popen.__init__, "_hitess_abaqus_shim", False):
        _installed = True
        return

    _orig_popen_init = subprocess.Popen.__init__

    def _patched_init(self, args, *rest, **kwargs):
        new_args = rewrite_command(args)
        kwargs = fix_encoding(new_args, kwargs)
        return _orig_popen_init(self, new_args, *rest, **kwargs)

    _patched_init._hitess_abaqus_shim = True
    subprocess.Popen.__init__ = _patched_init
    _installed = True
