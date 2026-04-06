Set fso = CreateObject("Scripting.FileSystemObject")
vbsDir = fso.GetParentFolderName(WScript.ScriptFullName)
backendDir = vbsDir & "\HiTessWorkBenchBackEnd"

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = backendDir
shell.Run """" & backendDir & "\WorkBenchEnv\Scripts\pythonw.exe"" """ & backendDir & "\server_manager.py""", 0, False
