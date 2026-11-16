# Surge 五项流媒体检测

独立维护的 Surge 脚本仓库。检测项目与 [Howaboutcoffee/QuantumultX](https://github.com/Howaboutcoffee/QuantumultX) 定制版一致，顺序为：**ChatGPT → Gemini → Netflix → Disney Plus+ → Youtube Premium**。保留 Rabbit-Spec / LucaLin233 Stream-All 的原生面板标题、图标和颜色，每项一行。

## 在线安装

已有 Stream-All 面板时，将它的 `script-path` 换成下面的脚本链接，保留 `type=generic, timeout=15`，然后更新脚本缓存、刷新面板。

- 脚本：<https://raw.githubusercontent.com/Howaboutcoffee/Surge/main/Stream-All.js>
- 模块：<https://raw.githubusercontent.com/Howaboutcoffee/Surge/main/Stream-All.sgmodule>

也可在 Surge 的模块管理中通过 URL 安装上述模块；先停用原同名模块，避免重复配置。模块默认 600 秒刷新一次。手动配置如下：

```ini
[Panel]
stream-all = script-name=stream-all, title="流媒体解锁检测", content="请刷新面板", update-interval=600

[Script]
stream-all = type=generic, timeout=15, script-path=https://raw.githubusercontent.com/Howaboutcoffee/Surge/main/Stream-All.js?v=f91629a
```

需要本地使用时，将 `Stream-All.js` 导入 Surge 脚本编辑器，并把 `script-path` 改为本地脚本名称 `Stream-All.js`。

模块更新和脚本缓存更新相互独立。模块中的脚本链接带版本标记；发布脚本改动时同步更新此标记，让模块更新后使用新下载地址。如果仍显示旧结果，请刷新面板，并确认旧模块已经停用。

## 行为和判定

- 与原 Surge 脚本一样，请求沿用当前 Surge 出站与分流设置，不指定或修改策略组。因此不同服务可能走不同出口；若要比较某个节点，需先让对应规则指向该节点。面板不虚构一个“全部服务共同使用的节点名”。
- 五项并发执行，共 7 次 HTTP 请求。单次最多 7 秒，整体 12 秒收尾；模块超时 15 秒。面板每 600 秒刷新，亦可手动刷新。单项失败保留其他结果。
- ChatGPT、Gemini、Netflix、Youtube Premium 采用现有 QuanX 检测与简洁状态文案。Disney 沿用当前 Surge 上游的匿名 `registerDevice` 接口，并严格校验支持地区字段；未使用 QuanX 的三步授权流程。
- “支持”表示匿名网页或地区检测通过，不代表已验证登录、对话、付费资格或实际播放。Netflix 检查两个非自制片样本；“未支持”仅表示两个样本不可用，不能据此判定仅自制。
- 明确地区不支持才显示“未支持”；超时、网页验证、字段缺失和接口错误分别显示相应状态。未知地区不猜国旗。TW 沿用 QuanX 的 🇨🇳 显示约定。
- 无需 MITM。保持 TLS 证书验证，不记录响应正文或匿名令牌。公开 Disney 浏览器标识不是私人凭据。

## 验证

```sh
node --check Stream-All.js
node --test tests/surge-stream-all.test.cjs
```

测试模拟 Surge `$httpClient` 回调与面板输出，包括正常、限制、验证、字段缺失、异常隔离、超时和只结束一次；也覆盖原生引擎没有 `clearTimeout` 的情况。未进行 Surge 真机、真实节点、播放或账号登录验收。导入后应逐项核对五项结果及切换出口后的刷新。

## 来源

- [现用 Surge 上游脚本](https://github.com/Rabbit-Spec/Surge/blob/Master/Module/Panel/Stream-All/Moore/Stream-All.js)，原作者 LucaLin233，Rabbit-Spec 修改。
- [对应 QuanX 脚本](https://github.com/Howaboutcoffee/QuantumultX/blob/master/Scripts/streaming-ui-check.js)，原始贡献者见文件头。
- [Surge JavaScript API](https://manual.nssurge.com/scripting/api.html) 与 [面板文档](https://manual.nssurge.com/tools/panel.html)。
