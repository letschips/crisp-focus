# Changelog

## 1.4.0

- 重磅升级打字机定焦滚动（Typewriter Scrolling）：基于 CodeMirror 6 ViewPlugin 架构，将输入行稳定维持在视口黄金高度（默认 42%）。
- 提供双运行模式：平滑区间模式（Soft Mode，容差带内自由书写，出界平滑推回）与严格定焦模式（Strict Mode，每行精确居中）。
- 智能交互保护：支持鼠标滚轮主动滚动避让，并在敲击键盘或输入时无缝恢复定焦。
- 深度适配中文输入法（IME）：拼音组字阶段防抖，上屏或空格提交时精准对齐黄金视线。
- 动态末尾留白（Bottom Padding）：末尾段落也能完美定焦，彻底告别屏幕底端局促书写。
- 场景与命令预设：复古打字机等预设场景全面联动打字机定焦，提供命令面板快捷切换指令。

## 1.3.4

- 深度对齐 Animated Cursor 物理动效架构：完整接管 CodeMirror 6 光标图层 Markers，采用 `requestAnimationFrame` + `translate` 复合层坐标插值与 10ms 防抖更新，彻底消除掉帧与粘滞，手感达到顶级丝滑。

## 1.3.3

- 光标引擎重构升级：引入 GPU 硬件加速 `translate3d` 亚像素平滑插值算法与 350ms 打字常亮消抖，优化 Markdown 表格坐标穿透，带来极致跟手且锐利的物理弹簧手感。

## 1.3.2

- 极致启动性能优化：启动阶段取消同步网络等待，改为后台异步非阻塞刷新，插件启动耗时从 832ms 骤降至 3ms。

## 1.3.1

- 统一离线授权验证逻辑：与全家桶其他 4 款插件完全对齐，支持本地 Ed25519 密码学公钥签名直接验证与断网降级，不再受 7 天离线时间窗限制。

## 1.3.0

- 新增 1–240 分钟专注会话，支持开始、暂停、继续、结束与完成提醒。
- 状态栏实时显示剩余时间；点击状态栏可开始会话或切换暂停/继续。
- 命令面板新增 25 分钟、50 分钟、暂停/继续与结束快捷命令。
- 会话状态按转换节点持久化，插件重载后可恢复尚未完成的倒计时，避免每秒写盘。
- 暂停会话会停止环境音；结束或完成会话会关闭 Focus mode 并清理音频。

## 1.2.0

- 新增静默写作、复古打字机、雨天写作与海边禅写四个原子场景预设。
- 场景会一次性应用光标、按键反馈、环境音与音量，不会留下半套配置。
- 静默写作免费可用；包含付费音频的场景统一复用运行时授权门禁。
- 设置页与命令面板均可切换场景；手动修改场景控制项后自动标记为“自定义”。

## 1.1.15

- 将授权状态接入音频运行链路：未激活、过期或被撤销时，打字音效与环境音不会继续播放。
- 新增统一授权状态缓存，启动时验证一次；在线验证后提供 7 天离线宽限期。
- 新安装默认关闭付费打字音效，授权码输入改为遮罩，并仅在激活成功后保存。
- 授权验证不再依赖全局 `window.app`，补充 WebCrypto Ed25519 能力提示与异常数据校验。
- 修正文档中的“纯离线 / 无网络请求”描述，并明确设备校验字段与本地存储边界。
- 最低 Obsidian 版本调整为 1.9.10，插件描述改为准确的 spring-eased 光标动效。

## 1.1.14

- 补齐设置分组、重置提示与命令通知的中文文案，修复 1.1.13 汉化不完整的问题。
- Crisp 系列授权产品名单补齐 Crisp Organize 与 Crisp Base。
- 修复运行时、样式、manifest、package 与 versions 的版本号漂移。

## 1.1.13

- 设置页全面汉化：设置项与描述改为中文（音效主题/环境音选项保持中英双语）。

## 1.1.12

- 修复通过命令面板切换音效时绕过许可证检查的问题：未激活用户现在无法通过命令开启付费打字音效。
- 修复 `stopAmbient` 不释放 `ambientAudioEl` 的问题：暂停后清除 `src` 并置 null，允许 GC 回收。

## 1.1.11

- 授权在线校验修复：服务端吊销或设备数超限的拒绝现在会被客户端采信（仅网络异常时降级为离线验签）。

## 1.1.10

- 修复 iOS 中文输入（组合输入）无打字音效的问题，桌面中文输入法不重复发声。

## 1.1.9

- 修复 iOS 屏幕键盘下普通字符无打字音效的问题（补充 beforeinput 兜底，桌面端不受影响）。

## 1.1.8

- 授权校验机制更新：此版本仅接受新版授权码，旧版授权码需联系重新签发。

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
