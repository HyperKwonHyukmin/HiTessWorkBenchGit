Set fso = CreateObject("Scripting.FileSystemObject")
gitDir = fso.GetParentFolderName(WScript.ScriptFullName)
backendDir = gitDir & "\HiTessWorkBenchBackEnd"
pythonw = backendDir & "\WorkBenchEnv\Scripts\pythonw.exe"
script  = backendDir & "\server_manager.py"

If Not fso.FileExists(pythonw) Then
    MsgBox "pythonw.exe 를 찾을 수 없습니다." & vbCrLf & pythonw, 16, "HiTESS Server"
    WScript.Quit
End If

If Not fso.FileExists(script) Then
    MsgBox "server_manager.py 를 찾을 수 없습니다." & vbCrLf & script, 16, "HiTESS Server"
    WScript.Quit
End If

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = backendDir
shell.Run """" & pythonw & """ """ & script & """", 0, False
