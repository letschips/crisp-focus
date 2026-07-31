# Changelog

## 1.1.7

- 在线设备校验改用 Obsidian requestUrl（与 ASR/Annotations 一致），修复 Electron/CSP 环境下 fetch 校验失败静默降级的问题。

## 1.1.6

- 授权校验升级：启用双公钥过渡机制，存量授权码不受影响。

## 1.1.5

- 设置页底部新增 `About Crisp Focus`，说明插件最核心的专注书写价值。
- 作者统一标注为“小红书 letschips”，并链接到作者主页。
- 新增 About 区块回归测试；完整门禁现为 16 项测试。

## 1.1.4

- Animated cursor 现在按 CodeMirror 编辑器实例分别挂载；多分栏、切换编辑器与弹出窗口不再被第一个光标层占用。
- 卸载时统一取消延迟挂载并释放每个编辑器的光标补丁，避免热重载后残留。
- 新增多编辑器光标层回归测试；完整门禁现为 15 项测试。

## 1.1.3

- 修正 Focus 在 CM6 未绘制动画光标标记时仍隐藏原生光标的问题；现在只有动画光标元素实际生成后才进入 `crisp-focus-active` 状态，空光标层会立即恢复原生光标。
- 增加空 CM6 光标层的行为回归测试；完整门禁现为 14 项测试。

## 1.1.2

- 将原生 CM6 光标隐藏规则限定到已挂载 `crisp-focus-active` 的编辑器；动画光标尚未接管、Focus mode 关闭或 Animated cursor 关闭时，原生光标保持可见。
- 补充光标 CSS 作用域回归测试；完整门禁现为 13 项测试。

## 1.1.1

- 接通 1.1.0 已声明但未实际使用的共享 Web Audio 限幅器，所有合成按键音统一经过同一输出链，减少快速输入叠加削波。
- 环境音已在播放时不再被每次按键重复调用 `play()`。
- Focus mode 关闭时，用户手势不再无意义创建或唤醒 AudioContext。
- 修正 Backspace 与 DOMTokenList 测试桩，使回归测试覆盖真实浏览器行为；完整门禁为 12 项测试。

## 1.1.0

- Added a Focus mode master switch and pop-out window support.
- Fixed the default Backspace sound crash and zero ambient-volume handling.
- Fixed duplicate IME confirmation sounds and cursor cleanup on disable/unload.
- Reused typewriter noise buffers and removed duplicate ambient play calls.
- Added a shared limiter for synthesized typing sounds.
- Normalized bundled ambient tracks and reduced their bitrate to 192 kbps.
- Added reduced-motion styling and simplified the settings interface.
- Added regression tests and a repeatable validation command.
