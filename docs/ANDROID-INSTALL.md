# 手机安装指南（Android / Termux）

本仓库是**完整可运行的 SillyTavern 副本**（含预设、正则、扩展、服务端插件、世界书、主题），
`node_modules` 已排除，首次安装需在手机上重建依赖。

> iOS 无法原生运行 Node.js，请用下面的「方案 B：远程访问」连接电脑上的实例。

---

## 方案 A：Termux 原生运行（推荐 Android）

### 1. 安装 Termux

**不要**从 Google Play 安装（版本已停更）。用其一：

- F-Droid：<https://f-droid.org/en/packages/com.termux/>
- GitHub Releases：<https://github.com/termux/termux-app/releases>

### 2. 换源并更新

```bash
termux-change-repo      # 选 Mirror group，挑最快的镜像
pkg update && pkg upgrade -y
```

### 3. 安装依赖

```bash
pkg install git nodejs-lts -y
```

> 32 位安卓额外执行：`pkg install esbuild -y`

### 4. 克隆本仓库

```bash
git clone -b release https://github.com/mrgreennya-cell/mrgreen.git SillyTavern
cd SillyTavern
```

### 5. 安装 Node 依赖（约 280MB，慢，建议挂梯子或连 WiFi）

```bash
npm install
```

### 6. 启动

```bash
bash start.sh
```

浏览器打开 `http://127.0.0.1:8000`。

### 7. 填写 API

首次进入后在「API 连接」里填你的 DeepSeek Key，模型选 `deepseek-flash`。
（仓库里不含任何密钥，预设与扩展已经配好，填完即可用。）

---

## 手机性能优化（config.yaml）

手机内存有限，建议编辑 `config.yaml`：

```yaml
performance:
  lazyLoadCharacters: true      # 角色卡按需加载
  useDiskCache: false           # 关磁盘缓存省空间
backups:
  chat:
    enabled: false              # 关自动聊天备份省空间
```

编辑命令：`nano ~/SillyTavern/config.yaml`（nano 保存：`Ctrl+X` → `Y` → 回车）

---

## 常用命令

```bash
# 启动
cd ~/SillyTavern && bash start.sh

# 更新（保留本地配置）
cd ~/SillyTavern && git pull --rebase --autostash

# 更新依赖（package.json 变动后）
npm install
```

### 可选：设置别名

```bash
nano ~/.bashrc
```

加入：

```bash
alias st='cd ~/SillyTavern && bash start.sh'
alias stup='cd ~/SillyTavern && git pull --rebase --autostash'
alias pkgup='pkg update && pkg upgrade -y'
```

保存后执行 `source ~/.bashrc`，以后直接输入 `st` 启动。

---

## 防止 Termux 被系统杀后台

Android 会休眠后台进程，导致服务断掉：

1. 下拉通知栏找到 Termux 通知 → 点「Acquire wakelock」
2. 或在 Termux 里执行 `termux-wake-lock`
3. 系统设置里把 Termux 加入「电池优化白名单」

---

## 方案 B：远程访问电脑上的实例

不想让手机跑 Node，可以让手机当屏幕：

1. 电脑上编辑 `config.yaml`：

```yaml
listen: true
whitelistMode: true
whitelist:
  - 192.168.0.0/16      # 局域网段，按自己路由调整
```

2. 重启 SillyTavern，记下电脑内网 IP（`ipconfig`）
3. 手机浏览器访问 `http://<电脑IP>:8000`

> 开启 `listen: true` 后务必保留白名单，否则同网络任何设备都能访问。

---

## 常见问题

| 现象 | 解决 |
|---|---|
| `Unsupported platform: android arm LEtime-web` | 32 位安卓，执行 `pkg install esbuild` |
| `npm install` 极慢或卡住 | 换镜像：`npm config set registry https://registry.npmmirror.com` |
| 打开页面空白 | 检查是否在 `SillyTavern` 目录里启动，看终端有无报错 |
| 手机重启后配置丢失 | 配置在 `data/default-user/`，确保 `git pull` 前先 `commit` 或备份该目录 |
| 余额面板显示「余额读取失败」 | 需要在 `config.yaml` 里允许服务端插件：`enableServerPlugins: true` |
