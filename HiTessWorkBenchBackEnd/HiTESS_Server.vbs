Set fso = CreateObject("Scripting.FileSystemObject")
gitDir = fso.GetParentFolderName(WScript.ScriptFullName)
backendDir = gitDir & "\HiTessWorkBenchBackEnd"

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = backendDir
shell.Run """" & backendDir & "\WorkBenchEnv\Scripts\pythonw.exe"" """ & backendDir & "\server_manager.py""", 0, False
