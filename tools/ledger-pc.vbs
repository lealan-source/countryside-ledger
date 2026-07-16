' Countryside Ledger PC launcher: starts the photo bridge (hidden), then opens the app window.
Set sh = CreateObject("WScript.Shell")
sh.Run """C:\Program Files\nodejs\node.exe"" ""C:\Users\StoreLIVE\Documents\Country Ledger\tools\photo-bridge.js""", 0, False
WScript.Sleep 400
sh.Run """C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"" --app=https://lealan-source.github.io/countryside-ledger/", 1, False
