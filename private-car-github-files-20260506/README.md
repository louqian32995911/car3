# 私车公用轨迹记录

## 本机网页打开

```bash
cd "/Users/dongyu/Documents/New project"
node server.js
```

然后打开：

```text
http://localhost:5173/
```

手机访问时，请让手机和电脑连接同一个 Wi-Fi，然后使用终端打印的：

```text
手机同一 Wi-Fi 访问：http://电脑局域网IP:5173/
```

## 部署成网页

把 `index.html` 上传到任意静态网站托管服务即可。定位记录需要浏览器允许定位权限，线上建议使用 HTTPS。

高德地图 Web JS Key 已封装在应用配置中，页面上不需要用户填写。正式上线时请在高德控制台把网页域名加入 Key 的安全白名单。

## GitHub Pages 测试部署

1. 新建 GitHub 仓库。
2. 把本项目推送到仓库的 `main` 分支。
3. 在仓库 `Settings -> Pages` 中选择：
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/root`
4. 保存后等待部署完成，GitHub 会生成一个 HTTPS 测试地址。
