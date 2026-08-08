' Countryside Ledger PC launcher: starts the photo bridge (hidden), then opens
' the app in its own window. Paths are derived, so this works on any PC.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

bridge = fso.GetParentFolderName(WScript.ScriptFullName) & "\photo-bridge.js"
node = "node"
If fso.FileExists("C:\Program Files\nodejs\node.exe") Then node = "C:\Program Files\nodejs\node.exe"
If fso.FileExists(bridge) Then sh.Run """" & node & """ """ & bridge & """", 0, False

WScript.Sleep 400

url = "https://lealan-source.github.io/countryside-ledger/"
edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
If Not fso.FileExists(edge) Then edge = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
If fso.FileExists(edge) Then
  sh.Run """" & edge & """ --app=" & url, 1, False
Else
  sh.Run url, 1, False
End If
