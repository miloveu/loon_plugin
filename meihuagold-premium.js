/**
 * 黄金形态通会员改写 - Loon http-response 重写脚本（本题正式答案）
 *
 * 数据来源：抓包文件 643_1795359842680.har（Loon 抓包）第 8 条：
 *   GET https://btcapi.meihuagold.com/auth/me
 *   请求头 UA: btc/2 CFNetwork/...（黄金形态通 App），响应体为 Base64 编码 JSON。
 *
 * 与学习实例（WorkBuddy 演示站）的差异：
 *   演示站默认返回明文 JSON，切到 Base64 模式才编码；
 *   真实 App 的 /auth/me 响应体本身就是 Base64 编码（HAR 证据），
 *   因此本脚本必须「先解码 → 改字段 → 再编码回去」，否则 App 解析失败。
 *
 * 改写策略：保持 App 原有的响应格式（明文进明文出 / Base64 进 Base64 出），
 *   优先在服务器真实响应上改写字段；解析失败时回退到抓包数据模板。
 *   改写字段：premiumExpiresAt -> 2099-09-09、premiumFeatureEnabled -> true。
 */

const TARGET_EXPIRY = '2099-09-09';

// 抓包数据模板（HAR 第 8 条响应体 Base64 解码结果，作为兜底）
const CAPTURED = {
  ok: true,
  user: {
    id: '84a07833-b03c-4cea-8945-c2e095aeb77f',
    displayId: 'BTC0887802',
    nickname: null,
    locale: 'zh',
    createdAt: 1795359803,
    lastLoginAt: 1795359860,
    premiumFeatureEnabled: true,
    trialEndAt: 1791731615,
    premiumExpiresAt: null
  },
  pushPrefs: {
    symbol: 'btc',
    timeframe: null,
    bs: false,
    trend: false,
    smart: false,
    updatedAt: 1795359861
  },
  deviceCount: 0
};

/* ---------- UTF-8 与 Base64（纯 JS 实现，不依赖运行环境内置函数） ---------- */

function utf8Encode(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const c2 = str.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000)
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f)
      );
  }
  return out;
}

function utf8Decode(bytes) {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let cp;
    if (b < 0x80) {
      cp = b;
      i += 1;
    } else if (b < 0xe0) {
      cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      i += 2;
    } else if (b < 0xf0) {
      cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      i += 3;
    } else {
      cp =
        ((b & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      i += 4;
    }
    if (cp >= 0x10000) {
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else {
      out += String.fromCharCode(cp);
    }
  }
  return out;
}

function b64encode(str) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = utf8Encode(str);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : -1;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : -1;
    out += chars[b0 >> 2];
    out += chars[((b0 & 0x03) << 4) | (b1 >= 0 ? b1 >> 4 : 0)];
    out += b1 >= 0 ? chars[((b1 & 0x0f) << 2) | (b2 >= 0 ? b2 >> 6 : 0)] : '=';
    out += b2 >= 0 ? chars[b2 & 0x3f] : '=';
  }
  return out;
}

function b64decode(s) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const bytes = [];
  for (let i = 0; i < len; i += 4) {
    const i0 = chars.indexOf(clean[i]);
    const i1 = chars.indexOf(clean[i + 1]);
    const i2 = i + 2 < len ? chars.indexOf(clean[i + 2]) : -1;
    const i3 = i + 3 < len ? chars.indexOf(clean[i + 3]) : -1;
    const n =
      (i0 << 18) | (i1 << 12) | (i2 >= 0 ? i2 << 6 : 0) | (i3 >= 0 ? i3 : 0);
    bytes.push((n >> 16) & 0xff);
    if (i2 >= 0) bytes.push((n >> 8) & 0xff);
    if (i3 >= 0) bytes.push(n & 0xff);
  }
  return utf8Decode(bytes);
}

/* ---------- 主逻辑 ---------- */

function main() {
  // $response 只在 Loon 真实拦截到响应时存在；手动运行（脚本列表点 ▶）时没有，
  // 必须用 typeof 守卫，否则抛 ReferenceError: Can't find variable: $response
  const hasResponse =
    typeof $response !== 'undefined' && $response && typeof $response.body === 'string';
  const raw = hasResponse ? $response.body.trim() : '';

  // 1. 探测原响应格式：先按明文 JSON 试，失败再按 Base64 试
  let json = null;
  let wasBase64 = false;
  if (raw) {
    try {
      json = JSON.parse(raw);
    } catch (e) {
      try {
        json = JSON.parse(b64decode(raw));
        wasBase64 = true;
      } catch (e2) {
        json = null;
      }
    }
  }

  // 2. 无响应（手动运行）或解析失败时回退到抓包数据模板，按 App 原格式输出
  if (!json || typeof json !== 'object' || !json.user) {
    json = JSON.parse(JSON.stringify(CAPTURED));
    wasBase64 = true; // HAR 证据：App 拿到的就是 Base64
    if (!hasResponse && typeof $notify !== 'undefined') {
      $notify(
        '黄金形态通会员改写',
        '手动运行（无拦截响应）',
        '已用抓包数据模板生成改写后的 /auth/me 响应体'
      );
    }
  }

  // 3. 改写会员状态：到期时间 2099-09-09，Premium 特性可用
  json.user.premiumFeatureEnabled = true;
  json.user.premiumExpiresAt = TARGET_EXPIRY;

  // 4. 按原格式回写：Base64 进 Base64 出，明文进明文出
  const plain = JSON.stringify(json);
  const body = wasBase64 ? b64encode(plain) : plain;

  console.log(
    '[黄金形态通会员改写] 已改写 /auth/me，原格式=' + (wasBase64 ? 'base64' : 'json')
  );

  $done({
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    },
    body: body
  });
}

main();
