// Loon 插件脚本（二合一）—— 论坛每日登录领积分
//   - 站点1: www.583go.com   (网吧三国)
//   - 站点2: www.clxp.net.cn (死性不改BBS)
//
// 同一份代码被插件以两种身份调用：
//   1) http-request 身份：Safari 登录论坛时抓取 Cookie（此时 $request 存在），存入 $persistentStore
//   2) cron 身份：每天定时登录论坛、领每日任务奖励（此时 $request 不存在）
//
// cron 身份的 Cookie 来源优先级：
//   1) 仓库 cookie_583go.txt / cookie_clxp.txt（可选，没上传就跳过）
//   2) http-request 抓取存入的 $persistentStore

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1";

const REPO_RAW = "https://raw.githubusercontent.com/miloveu/loon_plugin/main/";
const REPO_CDN = "https://cdn.jsdelivr.net/gh/miloveu/loon_plugin@main/";

const SITES = [
  {
    name: "网吧三国",
    key: "583go",
    host: "583go.com",
    home: "http://www.583go.com/forum.php",
    cookieFiles: [REPO_RAW + "cookie_583go.txt", REPO_CDN + "cookie_583go.txt"],
  },
  {
    name: "死性不改BBS",
    key: "clxp",
    host: "clxp.net.cn",
    home: "https://www.clxp.net.cn/forum.php",
    cookieFiles: [REPO_RAW + "cookie_clxp.txt", REPO_CDN + "cookie_clxp.txt"],
  },
];

// ─────────────────── Cookie 抓取（http-request 身份） ───────────────────

function captureCookie() {
  const headers = $request.headers || {};
  const raw = headers["Cookie"] || headers["cookie"];
  const url = $request.url || "";

  if (!raw) {
    console.log("请求头无 Cookie @ " + url);
    return;
  }

  // Discuz 登录态特征：同时包含 auth 和 saltkey
  if (!/auth=/.test(raw) || !/saltkey=/.test(raw)) {
    console.log("Cookie 无登录态特征，跳过保存 @ " + url);
    return;
  }
  const site = SITES.find(function (s) { return url.indexOf(s.host) !== -1; });
  if (!site) return;

  const storeKey = site.key + "_cookie";
  const old = $persistentStore.read(storeKey);
  if (old !== raw) {
    $persistentStore.write(raw, storeKey);
    $notification.post(site.name + " Cookie 已保存", "", "登录态已更新，每日登录脚本可正常使用");
  }
  console.log(site.name + " Cookie 已捕获");
}

// ─────────────────── 每日登录领积分（cron 身份） ───────────────────

function httpGet(url, cookie) {
  return new Promise(function (resolve, reject) {
    $httpClient.get(
      { url: url, headers: { "User-Agent": UA, Cookie: cookie || "" } },
      // Loon/Surge 回调签名：function(error, response, body)，成功时 error 为 null
      function (error, response, body) {
        if (error) {
          reject(new Error(String(error) + " @ " + url));
        } else if (!body) {
          reject(new Error("空响应 @ " + url));
        } else {
          resolve(body);
        }
      }
    );
  });
}

function isLoginCookie(s) {
  return /auth=/.test(s) && /saltkey=/.test(s);
}

function uniq(arr) {
  const seen = {};
  return arr.filter(function (x) {
    if (seen[x]) return false;
    seen[x] = 1;
    return true;
  });
}

// Cookie 来源：仓库文件（可选）→ 抓取缓存
async function resolveCookie(site) {
  // 1. 仓库 cookie 文件（没有上传过会 404，静默跳过）
  for (const url of site.cookieFiles) {
    try {
      const raw = (await httpGet(url, "")).trim();
      if (raw && isLoginCookie(raw)) return { cookie: raw, from: "仓库文件" };
    } catch (e) {
      console.log("读取仓库 Cookie 文件跳过: " + e.message);
    }
  }
  // 2. http-request 抓取存入的缓存
  const stored = $persistentStore.read(site.key + "_cookie");
  if (stored && isLoginCookie(stored)) return { cookie: stored, from: "抓取缓存" };
  return null;
}

async function doSite(site) {
  const resolved = await resolveCookie(site);
  if (!resolved) {
    return "❌ 没有 Cookie。请用 Safari 登录一次该网站（保持 Loon 开启），或在仓库上传 cookie 文件";
  }
  const cookie = resolved.cookie;
  // mobile=no：Discuz 模板切换开关，强制返回电脑版页面（含 formhash/退出登录链接）
  // 否则脚本用 iPhone UA 会被返回手机版页面，缺少判断登录态所需的元素
  const reqCookie = cookie + "; mobile=no";

  // 1. 访问论坛首页 —— 相当于每天登录一次
  const homeBody = await httpGet(site.home, reqCookie);

  // Discuz 登录态特征：页面上存在退出登录链接（兼容手机版模板）
  const hasLogout = /mod=logging&action=logout|logging&action=logout|退出/.test(homeBody);
  const hasHash = /formhash=/.test(homeBody);
  const hasUid = /space-uid-\d+|uid=\d+&|member_center|个人中心/.test(homeBody);
  const isMobilePage = /手机版|mobile=/.test(homeBody);
  const loggedIn = hasLogout || (hasHash && hasUid) || (hasUid && isMobilePage);
  if (!loggedIn) {
    return (
      "❌ Cookie 已失效或未检测到登录态（来源: " + resolved.from + "），请在 Safari 重新登录该网站\n" +
      "[诊断] logout=" + hasLogout + " formhash=" + hasHash + " uid=" + hasUid + " cookieLen=" + cookie.length
    );
  }

  const hashMatch = homeBody.match(/formhash=([a-zA-Z0-9]+)/);
  const lines = ["✅ 每日登录成功（Cookie 来源: " + resolved.from + "）"];

  try {
    // 2. 查看任务页面，找到可领取的每日任务
    const taskBase = site.home.replace(/forum\.php.*$/, "");
    const taskBody = await httpGet(taskBase + "home.php?mod=task", reqCookie);

    // formhash 兜底：首页没有时从任务页提取
    let formhash = hashMatch ? hashMatch[1] : "";
    if (!formhash) {
      const m2 = taskBody.match(/formhash=([a-zA-Z0-9]+)/);
      formhash = m2 ? m2[1] : "";
    }

    const ids = uniq((taskBody.match(/do=apply&id=(\d+)/g) || []).map(function (s) {
      return s.match(/id=(\d+)/)[1];
    }));

    if (ids.length === 0) lines.push("今日暂无可领取的任务");

    // 3. 逐个申请任务并尝试领取奖励
    for (const id of ids) {
      let applyBody = "";
      try {
        applyBody = await httpGet(
          taskBase + "home.php?mod=task&do=apply&id=" + id + (formhash ? "&formhash=" + formhash : ""),
          reqCookie
        );
      } catch (e) {
        lines.push("任务#" + id + " 申请失败: " + e.message);
        continue;
      }

      // 申请后如果出现"领取奖励"链接（do=draw），则继续领取
      if (/do=draw/.test(applyBody)) {
        try {
          const drawBody = await httpGet(
            taskBase + "home.php?mod=task&do=draw&id=" + id + (formhash ? "&formhash=" + formhash : ""),
            reqCookie
          );
          const m = drawBody.match(/<div class="c">\s*([\s\S]*?)\s*<\/div>/);
          const msg = m ? m[1].replace(/<[^>]+>/g, "").trim() : "";
          lines.push("任务#" + id + ": " + (msg || "已领取"));
        } catch (e) {
          lines.push("任务#" + id + " 领取失败: " + e.message);
        }
      } else {
        const okMsg = applyBody.match(/(获得了|奖励|成功)[^<]{0,30}/);
        lines.push("任务#" + id + ": " + (okMsg ? okMsg[0].trim() : "已申请"));
      }
    }
  } catch (e) {
    lines.push("（任务页处理异常: " + e.message + "）");
  }
  return lines.join("\n");
}

async function main() {
  const results = [];
  for (const site of SITES) {
    try {
      results.push("【" + site.name + "】\n" + (await doSite(site)));
    } catch (e) {
      results.push("【" + site.name + "】\n❌ 执行异常: " + e.message);
    }
  }
  const now = new Date();
  const dateStr = now.getFullYear() + "-" + (now.getMonth() + 1) + "-" + now.getDate();
  $notification.post("每日登录领积分 " + dateStr, "", results.join("\n\n"));
  console.log(results.join("\n"));
  $done();
}

// ─────────────────── 入口：按调用身份分发 ───────────────────

if (typeof $request === "undefined" || $request === null) {
  main();           // cron 身份
} else {
  // http-request 身份：无论发生什么都必须 $done({}) 放行请求
  try {
    captureCookie();
  } catch (e) {
    console.log("captureCookie 异常: " + e);
  }
  $done({});        // 空对象 = 保持请求不变继续转发；无参会直接断开连接导致网站打不开
}
