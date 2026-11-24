/**
 * 黄金形态通 · 本地推送策略（Loon cron 定时脚本）
 *
 * 原理：APNs 推送由服务端按其数据库中的偏好下发，客户端改包无法触发。
 * 本脚本改为本地生成推送：定时轮询官方行情接口（公开数据，无需会员），
 * 检测 BTCUSDm 各周期趋势信号（B=买 / S=卖）变化，变化时用
 * $notification.post 发本地通知。数据真实，不依赖服务端推送通道。
 *
 * 数据来源：GET https://api.meihuagold.com/btc/BTC_min.json
 *   quotes[].trends = { M1, M5, M15, M30, H1, H4 }（值 B 或 S）
 */

const QUOTES_URL = 'https://api.meihuagold.com/btc/BTC_min.json';
const SNAPSHOT_KEY = 'mg_trend_snapshot';

function main() {
  $httpClient.get(
    { url: QUOTES_URL, headers: { Accept: 'application/json' } },
    function (error, response, data) {
      if (error || !data) {
        console.log('[本地推送策略] 行情拉取失败: ' + (error || '空响应'));
        $done();
        return;
      }

      let btc = null;
      try {
        const quotes = JSON.parse(data).quotes;
        btc = quotes.find(function (q) {
          return q.symbol === 'BTCUSDm';
        });
      } catch (e) {
        console.log('[本地推送策略] 行情解析失败: ' + e);
        $done();
        return;
      }
      if (!btc || !btc.trends) {
        $done();
        return;
      }

      const now = btc.trends;
      let prev = null;
      try {
        const s = $persistentStore.read(SNAPSHOT_KEY);
        if (s) prev = JSON.parse(s);
      } catch (e2) {}

      if (prev) {
        const changes = [];
        for (const tf in now) {
          if (prev[tf] && prev[tf] !== now[tf]) {
            const dir = now[tf] === 'B' ? '买入信号' : '卖出信号';
            changes.push(tf + ' 周期: ' + prev[tf] + ' -> ' + now[tf] + '（' + dir + '）');
          }
        }
        if (changes.length) {
          $notification.post(
            '黄金形态通 · 趋势信号变化',
            'BTCUSDm ' + btc.price,
            changes.join('\n')
          );
        }
      }

      // 首次运行只记录快照，不推送；之后每次与上次快照对比
      try {
        $persistentStore.write(JSON.stringify(now), SNAPSHOT_KEY);
      } catch (e3) {}
      $done();
    }
  );
}

main();
