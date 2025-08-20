// server.js
const express = require('express');
const crypto = require('crypto');
const xml2js = require('xml2js');

const app = express();

// 让 Express 接收原始 XML 文本（很关键）
app.use(express.text({ type: ['text/xml', 'application/xml', 'application/octet-stream'] }));

// 健康检查
app.get('/', (req, res) => res.send('OK'));

/**
 * 微信支付 V2 回调（JSAPI + MD5）
 * 回调 URL 填这里： https://你的云托管域名/notify
 * 注意：这套是最简 V2 方案，便于测试；生产更建议上 V3（证书+RSA）。
 */
const MCH_KEY_V2 = process.env.MCH_KEY_V2 || '请在环境变量里配置商户V2密钥';

function buildSign(params) {
  // 参与签名的参数按字典序，并且剔除 sign 和空值
  const keys = Object.keys(params)
    .filter(k => k !== 'sign' && params[k] !== undefined && params[k] !== '')
    .sort();

  const qs = keys.map(k => `${k}=${params[k]}`).join('&') + `&key=${MCH_KEY_V2}`;
  return crypto.createHash('md5').update(qs, 'utf8').digest('hex').toUpperCase();
}

function xmlReply(code, msg) {
  return `<xml><return_code><![CDATA[${code}]]></return_code><return_msg><![CDATA[${msg}]]></return_msg></xml>`;
}

// 支付回调
app.post('/notify', async (req, res) => {
  try {
    const xml = req.body || '';
    const parsed = await new Promise((resolve, reject) => {
      xml2js.parseString(xml, { explicitArray: false, trim: true }, (err, data) => {
        if (err) reject(err);
        else resolve(data?.xml || {});
      });
    });

    // 1) 基本校验
    if (parsed.return_code !== 'SUCCESS') {
      return res.type('application/xml').send(xmlReply('FAIL', 'return_code not SUCCESS'));
    }

    // 2) 验签
    const signLocal = buildSign(parsed);
    if (signLocal !== parsed.sign) {
      return res.type('application/xml').send(xmlReply('FAIL', 'SIGN ERROR'));
    }

    // 3) 业务结果
    if (parsed.result_code === 'SUCCESS') {
      const out_trade_no = parsed.out_trade_no;
      const total_fee = parsed.total_fee;
      const transaction_id = parsed.transaction_id;

      // TODO: 在你的数据库里把订单 out_trade_no 标记为“已支付”，记录 transaction_id、金额等
      // 这里可加幂等（先查状态，已处理直接返回SUCCESS）

      return res.type('application/xml').send(xmlReply('SUCCESS', 'OK'));
    } else {
      return res.type('application/xml').send(xmlReply('FAIL', parsed.err_code_des || 'result_code FAIL'));
    }
  } catch (e) {
    console.error('notify error:', e);
    return res.type('application/xml').send(xmlReply('FAIL', 'SERVER ERROR'));
  }
});

// 云托管默认会注入 PORT 环境变量
const PORT = process.env.PORT || 80;
app.listen(PORT, () => console.log(`Notify server listening on ${PORT}`));
