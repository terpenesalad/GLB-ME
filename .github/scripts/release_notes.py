"""Builds the GitHub release body for a version from RELEASE_NOTES.md plus a downloads table."""
import re, sys
ver = sys.argv[1]
s = open('RELEASE_NOTES.md', encoding='utf-8').read()
start = s.find(f'## GLB&ME {ver}')
if start < 0:
    print(f'GLB&ME {ver}'); sys.exit()
nxt = re.search(r'\n## GLB&ME ', s[start + 5:])
sec = s[start:start + 5 + nxt.start()] if nxt else s[start:]
head, rest = sec.split('\n', 1)
import os
android = open('version.txt').read().strip() if os.path.exists('version.txt') else ver
apk = f"`GLB-ME-{ver}.apk`" if android == ver else f"`GLB-ME-{android}.apk` – from [v{android}](https://github.com/terpenesalad/GLB-ME/releases/tag/v{android})"
dl = f"""
### Downloads
| Device | File |
|---|---|
| Android 8.0+ | {apk} |
| **Windows 10/11** | **`GLB-ME-Setup-{ver}.exe`** (installer) or `GLB-ME-{ver}-portable.exe` (no install needed) |
| macOS (Intel & Apple silicon) | `GLB-ME-{ver}-mac.dmg` |
| Linux | `GLB-ME-{ver}-linux-x86_64.AppImage` or `GLB-ME-{ver}-linux-amd64.deb` |

> The PC installers aren't code-signed yet: on Windows choose **More info → Run anyway** if SmartScreen appears; on macOS right-click the app → **Open** the first time.
"""
print(head + '\n' + dl + rest)
