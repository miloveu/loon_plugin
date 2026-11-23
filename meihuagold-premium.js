/**
 * 黄金形态通会员改写 - Loon http-response 脚本
 * 数据来源：643_1795359842680.har 第 8 条 GET /auth/me（响应为明文 JSON）
 * 改写：user.premiumExpiresAt / user.premiumFeatureEnabled
 */

// 2099-09-09T00:00:00Z。该 API 时间字段均为 epoch 秒数字，
// 写成字符串会让 App 的 JSONDecoder 类型校验失败
const TARGET_EXPIRY_EPOCH = 4092595200;

// 抓包数据模板：仅手动运行时使用
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

/* ---------- UTF-8 / Base64（不依赖运行环境内置函数） ---------- */

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
  // 手动运行时没有 $response，需守卫
  const hasResponse =
    typeof $response !== 'undefined' && $response && typeof $response.body === 'string';
  const raw = hasResponse ? $response.body.trim() : '';

  // 先按明文解析，失败再按 Base64
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

  // 解析失败原样放行：登录响应含 token 等必填字段，替换模板会导致解码失败
  if (!json || typeof json !== 'object' || !json.user) {
    if (hasResponse) {
      console.log('[黄金形态通会员改写] 响应解析失败，原样放行');
      $done({
        status: $response.status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': String(utf8Encode(raw).length)
        },
        body: raw
      });
      return;
    }
    json = JSON.parse(JSON.stringify(CAPTURED));
    wasBase64 = false;
    if (typeof $notify !== 'undefined') {
      $notify(
        '黄金形态通会员改写',
        '手动运行（无拦截响应）',
        '已用抓包数据模板生成改写后的响应体'
      );
    }
  }

  json.user.premiumFeatureEnabled = true;
  json.user.premiumExpiresAt = TARGET_EXPIRY_EPOCH;

  const plain = JSON.stringify(json);
  const body = wasBase64 ? b64encode(plain) : plain;

  console.log(
    '[黄金形态通会员改写] 已改写，原格式=' + (wasBase64 ? 'base64' : 'json')
  );

  // 必须同时替换响应头：原响应经 Cloudflare 压缩，Loon 交来的是解压正文，
  // 保留 Content-Encoding 会让 App 把明文当压缩数据解码
  $done({
    status: hasResponse ? $response.status : 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(wasBase64 ? body.length : utf8Encode(plain).length)
    },
    body: body
  });
}

main();
