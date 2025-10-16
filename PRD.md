# Cloudflare Workers 图床系统设计文档

## 📌 项目概述

基于 Cloudflare Workers + R2 的极简个人图床系统，支持图片上传、文件管理、文件夹操作等功能。采用单用户密码认证模式，无需数据库。

---

## 🏗️ 系统架构

### 架构图

```
┌─────────────┐
│   用户浏览器   │
└──────┬──────┘
       │ HTTPS
       ↓
┌─────────────────────────────┐
│   Cloudflare Workers        │
│  ┌─────────────────────┐   │
│  │  路由层 (Router)     │   │
│  └──────┬──────────────┘   │
│         ↓                   │
│  ┌─────────────────────┐   │
│  │  认证中间件          │   │
│  └──────┬──────────────┘   │
│         ↓                   │
│  ┌─────────────────────┐   │
│  │  API 处理层          │   │
│  │  - 上传处理          │   │
│  │  - 文件管理          │   │
│  │  - 文件夹操作        │   │
│  └──────┬──────────────┘   │
└─────────┼──────────────────┘
          │
    ┌─────┴─────┐
    ↓           ↓
┌────────┐  ┌────────┐
│   KV   │  │   R2   │
│(Session)│  │(存储)  │
└────────┘  └────────┘
```

### 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | Vanilla JS + Tailwind CSS | 单 HTML 文件，无构建步骤 |
| 后端 | Cloudflare Workers | Serverless 边缘计算 |
| 存储 | Cloudflare R2 | S3 兼容对象存储 |
| 缓存 | Cloudflare KV | Session 存储 |
| 部署 | Wrangler CLI | Cloudflare 官方工具 |

---

## 📂 项目结构

```
cloudflare-image-host/
├── src/
│   ├── worker.js              # Worker 主入口
│   ├── handlers/
│   │   ├── auth.js            # 认证处理
│   │   ├── upload.js          # 上传处理
│   │   ├── files.js           # 文件管理
│   │   └── folders.js         # 文件夹管理
│   ├── utils/
│   │   ├── response.js        # 响应工具
│   │   └── validator.js       # 验证工具
│   └── static/
│       └── index.html         # 前端页面
├── wrangler.toml              # Cloudflare 配置
├── package.json
└── README.md
```

---

## 🔐 认证设计

### 认证流程

```
┌──────┐                    ┌──────────┐                  ┌─────┐
│ 用户 │                    │  Worker  │                  │ KV  │
└──┬───┘                    └────┬─────┘                  └──┬──┘
   │                             │                           │
   │  1. POST /api/auth          │                           │
   │  { password: "xxx" }        │                           │
   ├────────────────────────────>│                           │
   │                             │                           │
   │                             │  2. 验证密码               │
   │                             │  (env.APP_PASSWORD)       │
   │                             │                           │
   │                             │  3. 生成 token            │
   │                             │  (crypto.randomUUID())    │
   │                             │                           │
   │                             │  4. 存储 session          │
   │                             ├──────────────────────────>│
   │                             │  PUT session:{token}      │
   │                             │  TTL: 7天                 │
   │                             │                           │
   │  5. 返回 token              │                           │
   │<────────────────────────────┤                           │
   │  { token: "uuid" }          │                           │
   │                             │                           │
   │  6. 后续请求携带 token       │                           │
   │  Authorization: Bearer xxx  │                           │
   ├────────────────────────────>│                           │
   │                             │  7. 验证 token            │
   │                             ├──────────────────────────>│
   │                             │  GET session:{token}      │
   │                             │<──────────────────────────┤
   │                             │  "valid"                  │
```

### 数据结构

**KV 存储**
```javascript
Key: "session:{uuid}"
Value: "valid"
TTL: 604800 秒 (7天)
```

**环境变量**
```
APP_PASSWORD: 明文密码（仅用于演示，生产环境应使用 hash）
```

---

## 📤 上传功能设计

### 上传流程

```
┌──────┐              ┌──────────┐              ┌─────┐
│ 前端 │              │  Worker  │              │ R2  │
└──┬───┘              └────┬─────┘              └──┬──┘
   │                       │                       │
   │  1. 选择/拖拽文件      │                       │
   │                       │                       │
   │  2. FormData 上传     │                       │
   │  POST /api/upload     │                       │
   ├──────────────────────>│                       │
   │                       │                       │
   │                       │  3. 生成文件路径       │
   │                       │  YYYY/MM/timestamp-name│
   │                       │                       │
   │                       │  4. 上传到 R2          │
   │                       ├──────────────────────>│
   │                       │  PUT object           │
   │                       │                       │
   │                       │  5. 返回成功           │
   │                       │<──────────────────────┤
   │                       │                       │
   │  6. 返回 URL          │                       │
   │<──────────────────────┤                       │
   │  { url, key, ... }    │                       │
```

### 文件命名规则

```javascript
路径格式: {year}/{month}/{timestamp}-{original_name}
示例: 2025/01/1737012345678-photo.jpg
```

### 支持的文件类型

```javascript
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml'
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
```

### R2 对象元数据

```javascript
{
  httpMetadata: {
    contentType: 'image/jpeg',
    cacheControl: 'public, max-age=31536000'
  },
  customMetadata: {
    originalName: 'photo.jpg',
    uploadTime: '2025-01-16T04:00:00.000Z',
    size: '1234567'
  }
}
```

---

## 📁 文件管理设计

### R2 存储结构

```
bucket-name/
├── 2025/
│   ├── 01/
│   │   ├── 1737012345678-image1.jpg
│   │   ├── 1737012345679-image2.png
│   │   └── 1737012345680-image3.gif
│   └── 02/
│       └── 1737098745678-image4.jpg
├── custom-folder/
│   ├── .keep                    # 空文件夹标记
│   └── subfolder/
│       └── image5.jpg
└── uploads/
    └── image6.png
```

### 文件列表 API

**请求**
```http
GET /api/files?prefix=2025/01&limit=100&cursor=xxx
Authorization: Bearer {token}
```

**响应**
```json
{
  "files": [
    {
      "key": "2025/01/1737012345678-image1.jpg",
      "name": "image1.jpg",
      "size": 1234567,
      "uploaded": "2025-01-16T04:00:00.000Z",
      "url": "https://img.example.com/2025/01/1737012345678-image1.jpg",
      "type": "image/jpeg"
    }
  ],
  "folders": [
    "2025/02/",
    "custom-folder/"
  ],
  "truncated": false,
  "cursor": null
}
```

### 文件操作

| 操作 | 方法 | 端点 | 说明 |
|------|------|------|------|
| 列出文件 | GET | /api/files | 支持 prefix 过滤 |
| 删除文件 | DELETE | /api/files | 支持批量删除 |
| 获取统计 | GET | /api/stats | 存储用量统计 |
| 创建文件夹 | POST | /api/folders | 创建空标记文件 |
| 删除文件夹 | DELETE | /api/folders | 删除文件夹及内容 |

---

## 🗂️ 文件夹管理设计

### 创建文件夹

由于 R2 是对象存储（无真实文件夹概念），通过创建 `.keep` 空文件来标记文件夹：

```javascript
// 创建文件夹 "photos/vacation/"
await R2_BUCKET.put('photos/vacation/.keep', '', {
  httpMetadata: { contentType: 'text/plain' }
});
```

### 列出文件夹

使用 R2 的 `list()` 方法配合 `delimiter` 参数：

```javascript
const result = await R2_BUCKET.list({
  prefix: 'photos/',
  delimiter: '/'  // 按 / 分隔，返回文件夹列表
});

// result.delimitedPrefixes = ['photos/vacation/', 'photos/work/']
```

### 删除文件夹

递归删除文件夹下所有文件：

```javascript
async function deleteFolder(prefix) {
  let cursor;
  do {
    const list = await R2_BUCKET.list({ prefix, cursor });
    
    // 批量删除
    await Promise.all(
      list.objects.map(obj => R2_BUCKET.delete(obj.key))
    );
    
    cursor = list.truncated ? list.cursor : null;
  } while (cursor);
}
```

---

## 🎨 前端设计

### 页面结构

```
┌─────────────────────────────────────┐
│           导航栏                     │
│  [Logo] [上传] [文件管理] [设置]     │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│                                     │
│         主内容区                     │
│                                     │
│  - 登录页 (未认证)                   │
│  - 上传页 (默认)                     │
│  - 文件管理页                        │
│  - 设置页                           │
│                                     │
└─────────────────────────────────────┘
```

### 核心组件

#### 1. 登录组件
```html
<div class="login-container">
  <input type="password" id="password" placeholder="请输入密码">
  <button onclick="login()">登录</button>
</div>
```

#### 2. 上传组件
```html
<div id="upload-zone" ondrop="handleDrop(event)" ondragover="handleDragOver(event)">
  <p>拖拽图片到这里或点击上传</p>
  <input type="file" multiple accept="image/*" onchange="handleUpload(event)">
</div>

<div id="upload-progress" style="display:none">
  <div class="progress-bar"></div>
  <span class="progress-text">0%</span>
</div>

<div id="result" style="display:none">
  <img id="preview" src="">
  <div class="links">
    <input readonly value="" id="link-direct">
    <input readonly value="" id="link-markdown">
    <input readonly value="" id="link-html">
  </div>
</div>
```

#### 3. 文件管理组件
```html
<div class="file-manager">
  <!-- 面包屑导航 -->
  <div class="breadcrumb">
    <span onclick="navigateTo('')">根目录</span>
    <span onclick="navigateTo('2025/')">/ 2025</span>
    <span>/ 01</span>
  </div>
  
  <!-- 工具栏 -->
  <div class="toolbar">
    <button onclick="createFolder()">新建文件夹</button>
    <button onclick="deleteSelected()">删除选中</button>
    <input type="search" placeholder="搜索..." oninput="searchFiles(this.value)">
  </div>
  
  <!-- 文件网格 -->
  <div class="file-grid">
    <!-- 文件夹 -->
    <div class="folder-item" onclick="navigateTo('2025/01/')">
      <div class="folder-icon">📁</div>
      <div class="folder-name">01</div>
    </div>
    
    <!-- 文件 -->
    <div class="file-item">
      <input type="checkbox" class="file-checkbox">
      <img src="thumbnail.jpg" class="file-thumbnail">
      <div class="file-name">image.jpg</div>
      <div class="file-info">1.2 MB</div>
      <button onclick="copyLink('url')">复制链接</button>
      <button onclick="deleteFile('key')">删除</button>
    </div>
  </div>
</div>
```

### 核心 JavaScript 函数

```javascript
// 全局状态
const state = {
  token: localStorage.getItem('token'),
  currentPath: '',
  files: [],
  selectedFiles: []
};

// 认证
async function login() {
  const password = document.getElementById('password').value;
  const res = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  
  if (res.ok) {
    const { token } = await res.json();
    state.token = token;
    localStorage.setItem('token', token);
    showApp();
  } else {
    alert('密码错误');
  }
}

// 上传
async function handleUpload(event) {
  const files = event.target.files || event.dataTransfer.files;
  
  for (const file of files) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', state.currentPath);
    
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` },
      body: formData
    });
    
    const result = await res.json();
    showResult(result);
  }
}

// 加载文件列表
async function loadFiles(prefix = '') {
  const res = await fetch(`/api/files?prefix=${prefix}`, {
    headers: { 'Authorization': `Bearer ${state.token}` }
  });
  
  const { files, folders } = await res.json();
  state.files = files;
  renderFiles(files, folders);
}

// 删除文件
async function deleteFile(key) {
  if (!confirm('确定删除？')) return;
  
  await fetch('/api/files', {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${state.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ keys: [key] })
  });
  
  loadFiles(state.currentPath);
}

// 创建文件夹
async function createFolder() {
  const name = prompt('文件夹名称：');
  if (!name) return;
  
  const path = state.currentPath + name + '/';
  
  await fetch('/api/folders', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${state.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ path })
  });
  
  loadFiles(state.currentPath);
}

// 复制链接
function copyLink(url) {
  navigator.clipboard.writeText(url);
  showToast('链接已复制');
}
```

---

## 🔌 API 接口规范

### 通用响应格式

**成功响应**
```json
{
  "success": true,
  "data": { ... }
}
```

**错误响应**
```json
{
  "success": false,
  "error": "错误信息"
}
```

### 接口列表

#### 1. 认证

**POST /api/auth**

请求：
```json
{
  "password": "your_password"
}
```

响应：
```json
{
  "success": true,
  "token": "uuid-token"
}
```

---

#### 2. 上传文件

**POST /api/upload**

请求头：
```
Authorization: Bearer {token}
Content-Type: multipart/form-data
```

请求体：
```
FormData:
  - file: File
  - path: string (可选，默认按日期分类)
```

响应：
```json
{
  "success": true,
  "data": {
    "key": "2025/01/1737012345678-image.jpg",
    "url": "https://img.example.com/2025/01/1737012345678-image.jpg",
    "filename": "1737012345678-image.jpg",
    "size": 1234567,
    "type": "image/jpeg"
  }
}
```

---

#### 3. 获取文件列表

**GET /api/files**

请求参数：
```
?prefix=2025/01/        # 可选，文件夹前缀
&limit=100              # 可选，返回数量
&cursor=xxx             # 可选，分页游标
```

请求头：
```
Authorization: Bearer {token}
```

响应：
```json
{
  "success": true,
  "data": {
    "files": [
      {
        "key": "2025/01/1737012345678-image.jpg",
        "name": "image.jpg",
        "size": 1234567,
        "uploaded": "2025-01-16T04:00:00.000Z",
        "url": "https://img.example.com/2025/01/1737012345678-image.jpg",
        "type": "image/jpeg"
      }
    ],
    "folders": ["2025/02/", "custom/"],
    "truncated": false,
    "cursor": null
  }
}
```

---

#### 4. 删除文件

**DELETE /api/files**

请求头：
```
Authorization: Bearer {token}
Content-Type: application/json
```

请求体：
```json
{
  "keys": [
    "2025/01/1737012345678-image.jpg",
    "2025/01/1737012345679-image2.jpg"
  ]
}
```

响应：
```json
{
  "success": true,
  "deleted": 2
}
```

---

#### 5. 创建文件夹

**POST /api/folders**

请求头：
```
Authorization: Bearer {token}
Content-Type: application/json
```

请求体：
```json
{
  "path": "photos/vacation/"
}
```

响应：
```json
{
  "success": true,
  "path": "photos/vacation/"
}
```

---

#### 6. 删除文件夹

**DELETE /api/folders**

请求头：
```
Authorization: Bearer {token}
Content-Type: application/json
```

请求体：
```json
{
  "path": "photos/vacation/"
}
```

响应：
```json
{
  "success": true,
  "deleted": 15
}
```

---

#### 7. 获取统计信息

**GET /api/stats**

请求头：
```
Authorization: Bearer {token}
```

响应：
```json
{
  "success": true,
  "data": {
    "totalFiles": 1234,
    "totalSize": 1234567890,
    "totalSizeFormatted": "1.15 GB",
    "recentUploads": [
      {
        "key": "2025/01/1737012345678-image.jpg",
        "uploaded": "2025-01-16T04:00:00.000Z"
      }
    ]
  }
}
```

---

## ⚙️ 配置文件

### wrangler.toml

```toml
name = "image-host"
main = "src/worker.js"
compatibility_date = "2024-01-01"

# KV 命名空间
[[kv_namespaces]]
binding = "KV"
id = "your-kv-namespace-id"

# R2 存储桶
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "your-bucket-name"

# 环境变量
[vars]
R2_PUBLIC_DOMAIN = "https://img.yourdomain.com"

# 密钥（使用 wrangler secret put 设置）
# APP_PASSWORD
# 使用命令: wrangler secret put APP_PASSWORD
```

### package.json

```json
{
  "name": "cloudflare-image-host",
  "version": "1.0.0",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "wrangler": "^3.0.0"
  }
}
```

---

## 🚀 部署流程

### 1. 准备工作

```bash
# 安装依赖
npm install

# 登录 Cloudflare
npx wrangler login
```

### 2. 创建 R2 存储桶

```bash
# 创建存储桶
npx wrangler r2 bucket create your-bucket-name

# 配置公开访问（可选）
# 在 Cloudflare Dashboard 中配置自定义域名
```

### 3. 创建 KV 命名空间

```bash
# 创建 KV
npx wrangler kv:namespace create "KV"

# 复制返回的 ID 到 wrangler.toml
```

### 4. 设置密钥

```bash
# 设置密码
npx wrangler secret put APP_PASSWORD
# 输入你的密码
```

### 5. 部署

```bash
# 开发模式
npm run dev

# 生产部署
npm run deploy
```

### 6. 配置自定义域名（可选）

1. 在 Cloudflare Dashboard 中进入 R2 存储桶
2. 点击 "Settings" -> "Public Access"
3. 添加自定义域名（如 img.yourdomain.com）
4. 更新 `wrangler.toml` 中的 `R2_PUBLIC_DOMAIN`

---

## 🔒 安全考虑

### 1. 认证安全

```javascript
// 生产环境应使用密码 hash
const crypto = require('crypto');

// 存储 hash 而不是明文
const passwordHash = crypto
  .createHash('sha256')
  .update(password)
  .digest('hex');

// 验证时比较 hash
if (inputHash === env.PASSWORD_HASH) {
  // 验证通过
}
```

### 2. 文件验证

```javascript
// 验证文件类型
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
if (!ALLOWED_TYPES.includes(file.type)) {
  return new Response('不支持的文件类型', { status: 400 });
}

// 验证文件大小
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
if (file.size > MAX_SIZE) {
  return new Response('文件过大', { status: 400 });
}

// 验证文件内容（魔数检测）
const buffer = await file.arrayBuffer();
const uint8 = new Uint8Array(buffer);
// 检查 JPEG 魔数: FF D8 FF
if (uint8[0] === 0xFF && uint8[1] === 0xD8 && uint8[2] === 0xFF) {
  // 是有效的 JPEG
}
```

### 3. 速率限制

```javascript
// 使用 KV 实现简单的速率限制
async function checkRateLimit(ip, env) {
  const key = `ratelimit:${ip}`;
  const count = await env.KV.get(key);
  
  if (count && parseInt(count) > 100) {
    return false; // 超过限制
  }
  
  await env.KV.put(key, (parseInt(count || 0) + 1).toString(), {
    expirationTtl: 3600 // 1小时
  });
  
  return true;
}
```

### 4. CORS 配置

```javascript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // 生产环境应限制域名
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// 处理 OPTIONS 预检请求
if (request.method === 'OPTIONS') {
  return new Response(null, { headers: corsHeaders });
}
```

### 5. 路径遍历防护

```javascript
// 防止路径遍历攻击
function sanitizePath(path) {
  // 移除 ../ 和 ./
  return path.replace(/\.\.\//g, '').replace(/\.\//g, '');
}
```

---

## 📊 性能优化

### 1. 缓存策略

```javascript
// 设置 R2 对象缓存
await env.R2_BUCKET.put(key, file, {
  httpMetadata: {
    cacheControl: 'public, max-age=31536000', // 1年
  }
});

// Worker 响应缓存
return new Response(body, {
  headers: {
    'Cache-Control': 'public, max-age=3600',
    'CDN-Cache-Control': 'public, max-age=86400'
  }
});
```

### 2. 批量操作

```javascript
// 批量删除优化
async function batchDelete(keys, env) {
  const BATCH_SIZE = 100;
  
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(key => env.R2_BUCKET.delete(key))
    );
  }
}
```

### 3. 分页加载

```javascript
// 使用游标分页
async function listFiles(prefix, cursor, limit = 100) {
  const result = await env.R2_BUCKET.list({
    prefix,
    cursor,
    limit
  });
  
  return {
    files: result.objects,
    nextCursor: result.truncated ? result.cursor : null
  };
}
```

---