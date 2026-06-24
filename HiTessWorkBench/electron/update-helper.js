// 자동 업데이트 헬퍼 VBScript 생성기.
//
// 기존 헬퍼는 "새 실행 파일을 구버전 폴더로 복사 → 구버전 삭제 → 새 버전 실행"
// 순서였는데, 서버가 내려준 파일명이 현재 실행 파일명과 같으면
// destPath(복사 대상) == oldPath(현재 실행 파일) 가 되어
//   ① 새 파일을 oldPath 위에 복사
//   ② "구버전 삭제" 단계가 방금 복사한 새 파일을 지움
//   ③ 사라진 파일을 실행 → WScript 오류 80070002(파일을 찾을 수 없음)
// 라는 자기파괴가 일어났다(구버전만 삭제되고 새 버전은 실행되지 않음).
//
// 아래 버전은 destPath 와 oldPath 가 같을 때 삭제 단계를 건너뛰고,
// 복사 성공을 확인한 뒤에만 구버전을 지우며, 파일 잠금에 대비해 복사를 재시도한다.
function buildUpdateHelperVbs() {
  return [
    "WScript.Sleep 2000",
    "Dim oldPath, tmpPath, destPath, fso, shell, i, copyErr",
    "oldPath = WScript.Arguments(0)",
    "tmpPath = WScript.Arguments(1)",
    "Set fso = CreateObject(\"Scripting.FileSystemObject\")",
    "destPath = fso.BuildPath(fso.GetParentFolderName(oldPath), fso.GetFileName(tmpPath))",
    "' 새 실행 파일을 대상 경로로 복사 — 이전 인스턴스 종료 대기 위해 최대 10회 재시도",
    "For i = 1 To 10",
    "  On Error Resume Next",
    "  fso.CopyFile tmpPath, destPath, True",
    "  copyErr = Err.Number",
    "  On Error GoTo 0",
    "  If copyErr = 0 Then Exit For",
    "  WScript.Sleep 500",
    "Next",
    "' 복사 실패 시 구버전을 삭제하지 않고 안전하게 중단(기존 버전 보존)",
    "If Not fso.FileExists(destPath) Then WScript.Quit 1",
    "' 구버전 삭제는 새 파일과 경로가 다를 때만 — 같으면 방금 만든 새 파일을 지우게 됨",
    "If fso.FileExists(oldPath) And LCase(oldPath) <> LCase(destPath) Then",
    "  On Error Resume Next",
    "  fso.DeleteFile oldPath, True",
    "  On Error GoTo 0",
    "End If",
    "Set shell = CreateObject(\"WScript.Shell\")",
    "shell.Run Chr(34) & destPath & Chr(34)",
    "' 임시 다운로드 파일 정리 — 대상과 다를 때만",
    "On Error Resume Next",
    "If LCase(tmpPath) <> LCase(destPath) Then fso.DeleteFile tmpPath, True",
    "On Error GoTo 0",
    "WScript.Quit",
  ].join("\r\n");
}

module.exports = { buildUpdateHelperVbs };
