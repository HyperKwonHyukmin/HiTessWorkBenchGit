Set fso = CreateObject("Scripting.FileSystemObject")
backendDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = backendDir
shell.Run """" & backendDir & "\WorkBenchEnv\Scripts\pythonw.exe"" """ & backendDir & "\server_manager.py""", 0, False
