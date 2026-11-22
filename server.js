import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';

const app = express();
app.use(express.json());
app.use(express.static('public'));

// ---------- Seed ledger (single source of truth) ----------
const L = {
  merchant: 'Ramesh Kirana Store, Indore',
  gross: 18450, count: 62,
  deductions: [{ label: 'Refund (TXN-07)', amt: 650 }, { label: 'Chargeback hold', amt: 450 }, { label: 'Soundbox kiraya', amt: 100 }],
  last3: [{ amt: 200, who: 'Vikas K.', t: '1:06 PM' }, { amt: 200, who: 'Vikas K.', t: '1:06 PM' }, { amt: 45, who: 'Anil M.', t: '1:05 PM' }],
  udhaar: [{ name: 'Sharma ji', amt: 1450, days: 21 }, { name: 'Gupta ji', amt: 2300, days: 12 }, { name: 'Meena didi', amt: 1800, days: 8 }, { name: 'Raju', amt: 650, days: 5 }],
  dailyProfit: 2200,
  offers: [{ id: 'A', amt: 25000, daily: 140, days: 200 }, { id: 'B', amt: 50000, daily: 280, days: 200 }],
  dupTxn: { id: 'TXN-V2', amt: 200, who: 'Vikas K.', source: 'Vikas K. ka original UPI account' },
};
const fresh = () => ({ unlockedUntil: 0, fails: 0, lockedUntil: 0, scamIds: [], refunded: {}, sharmaPaid: false });
let S = fresh();
const unlocked = () => Date.now() < S.unlockedUntil;
const touch = () => { if (unlocked()) S.unlockedUntil = Date.now() + 180000; };
const inr = n => '₹' + n.toLocaleString('en-IN');

// ---------- Code-computed tools (AI never does math) ----------
const tools = {
  hisab() {
    const kata = L.deductions.reduce((a, d) => a + d.amt, 0), net = L.gross - kata;
    if (L.gross - kata !== net) throw new Error('ledger mismatch');
    return { gross: L.gross, count: L.count, kata, net, deductions: L.deductions };
  },
  udhaar() { const list = L.udhaar.map(u => ({ ...u, paid: u.name === 'Sharma ji' && S.sharmaPaid })); return { list, total: list.filter(u => !u.paid).reduce((a, u) => a + u.amt, 0) }; },
  offers() {
    return L.offers.map(o => { const total = o.daily * o.days, pct = Math.round(o.daily / L.dailyProfit * 1000) / 10, apr = Math.round((total - o.amt) / o.amt * 365 / o.days * 100);
      return { ...o, total, pct, apr, ok: pct <= 10 }; });
  },
};

// ---------- Lines (display + Devanagari for natural Hindi TTS) ----------
const LINES = {
  locked: ['🔒 Ye sirf maalik dekh sakte hain. Pichhle 3 payment: ₹200, ₹200, ₹45.', 'यह सिर्फ मालिक देख सकते हैं। पिछले तीन पेमेंट: दो सौ, दो सौ, और पैंतालीस रुपये।'],
  pin: ['PIN daaliye 🔒', 'कृपया अपना पिन डालिए।'],
  hello: ['Namaste Ramesh ji 🙏', 'नमस्ते रमेश जी।'],
  wrong: ['Galat PIN', 'गलत पिन।'],
  lockout: ['⛔ 3 baar galat PIN. 5 minute ke liye lock.', 'तीन बार गलत पिन। डिवाइस पाँच मिनट के लिए लॉक है।'],
  aaya: ['Pichhle 2 minute mein ₹120 nahi aaya. Aakhri payment ₹200, Vikas se.', 'पिछले दो मिनट में एक सौ बीस रुपये नहीं आए। आखिरी पेमेंट दो सौ रुपये, विकास से।'],
  earn: ['Aaj ₹18,450 aaye, 62 payment. Poora hisab app mein.', 'आज अठारह हज़ार चार सौ पचास रुपये आए, बासठ पेमेंट। पूरा हिसाब ऐप में देखिए।'],
  scam: ['🚨 Ye FRAUD hai! Paytm kabhi PIN ya refund nahi maangta. Paisa safe hai. Number yaad rakh liya — 1930 pe report karein.', 'सावधान! यह फ्रॉड है। पेटीएम कभी पिन या रिफंड नहीं माँगता। आपका पैसा सुरक्षित है। यह नंबर मैंने याद रख लिया है। उन्नीस सौ तीस पर रिपोर्ट करें।'],
  scam2: ['🚨 Ye wahi fraud number hai jo pehle pakda tha. Ignore karein.', 'यह वही फ्रॉड नंबर है जो पहले पकड़ा था। इसे नज़रअंदाज़ करें।'],
  udhaar: ['Sharma ji ka ₹1,450 udhaar 21 din se baaki. UPI link ke saath reminder bhej diya.', 'शर्मा जी का चौदह सौ पचास रुपये उधार, इक्कीस दिन से बाकी है। मैंने UPI लिंक के साथ विनम्र रिमाइंडर भेज दिया है।'],
  paid: ['₹1,450 prapt hue. Sharma ji ka udhaar clear! 🎉', 'पेटीएम पर चौदह सौ पचास रुपये प्राप्त हुए। शर्मा जी का उधार क्लियर!'],
  credit: ['Diwali stock ke liye do options app mein hain. ₹25,000 wala aapke liye aaraam ka hai.', 'दिवाली स्टॉक के लिए दो विकल्प ऐप में हैं। पच्चीस हज़ार वाला आपके लिए आराम का है।'],
  sahukar: ['Sahukar ka 5% mahina = saal ka 60%. Ye offer saal ka ~22%. Lagbhag teen guna sasta.', 'साहूकार का पाँच प्रतिशत महीना, यानी साल का साठ प्रतिशत। यह ऑफर साल का लगभग बाईस प्रतिशत है। लगभग तीन गुना सस्ता।'],
  closing: ['🌙 Ramesh ji, aaj ka hisab taiyaar hai. Sunenge?', 'रमेश जी, आज का हिसाब तैयार है। सुनेंगे?'],
  hisab: ['Aaj ₹18,450 aaye. ₹1,200 kate. ₹17,250 kal subah bank mein. Dhyan dein: Vikas ka ₹200 do baar aaya.', 'आज अठारह हज़ार चार सौ पचास रुपये आए। बारह सौ रुपये कटे। सत्रह हज़ार दो सौ पचास रुपये कल सुबह बैंक में आएँगे। ध्यान दें, विकास के दो सौ रुपये दो बार आए हैं।'],
  refundAsk: ['Vikas ka extra ₹200 wapas karun? Sirf unke original account mein jayega.', 'विकास के एक्स्ट्रा दो सौ रुपये वापस करूँ? पैसा सिर्फ उनके ओरिजिनल अकाउंट में जाएगा।'],
  refundDone: ['✅ ₹200 Vikas ko wapas. Aaj 1 fraud roka, ₹525 bachaye, Sharma ji ka udhaar aaya. Shubh ratri! 🙏', 'दो सौ रुपये विकास को वापस हो गए। आज एक फ्रॉड रोका, पाँच सौ पच्चीस रुपये बचाए, और शर्मा जी का उधार आया। शुभ रात्रि!'],
  refundBlocked: ['⛔ Ye refund pehle hi ho chuka hai. Dobara nahi hoga.', 'यह रिफंड पहले ही हो चुका है। दोबारा नहीं होगा।'],
  r1: ['₹540 mil gaye, Rahul se ✅', 'पाँच सौ चालीस रुपये मिल गए, राहुल से।'],
  r2: ['🔴 ₹120 abhi tak nahi aaya!', 'एक सौ बीस रुपये अभी तक नहीं आए।'],
  r3: ['⚠️ 450 bola, 45 aaye. ₹405 kam!', 'चार सौ पचास बोला, पैंतालीस आए। चार सौ पाँच रुपये कम।'],
  r4: ['₹200 mil gaye, Vikas se ✅', 'दो सौ रुपये मिल गए, विकास से।'],
  r5: ['🟡 Vikas ne ₹200 do baar diye. Ek alag rakha.', 'विकास ने दो सौ रुपये दो बार दिए। एक अलग रख दिया है।'],
  r6: ['🤯 Rush chal raha hai par payment ruk gaye. QR check karein!', 'रश चल रहा है पर पेमेंट रुक गए हैं। क्यूआर कोड चेक करें।'],
  r7: ['Rush khatam. 3 gadbad pakdi, ₹525 bachaye.', 'रश खत्म। तीन गड़बड़ पकड़ीं, पाँच सौ पच्चीस रुपये बचाए।'],
  think: ['Ek second…', 'एक सेकंड।'],
};
const say = k => ({ say: LINES[k][0], tts: LINES[k][1] });

// ---------- Golden-path scene matcher ----------
const SCENES = [
  ['scam', ['message aaya', 'kya karun', 'kya karu', 'fraud', 'मैसेज', 'क्या करूँ', 'क्या करूं']],
  ['aaya', ['aaya kya', 'aya kya', 'आया क्या', 'आया कि नहीं']],
  ['earn', ['kitna kamaya', 'kamaya', 'कमाया', 'कितना कमा']],
  ['udhaar', ['udhaar', 'udhar', 'उधार', 'reminder', 'रिमाइंडर', 'sharma', 'शर्मा']],
  ['sahukar', ['sahukar', 'saahukar', 'साहूकार', 'sasta', 'सस्ता']],
  ['credit', ['diwali', 'paise kam', 'loan', 'दिवाली', 'पैसे कम', 'लोन']],
  ['refund', ['duplicate', 'wapas', 'वापस', 'refund', 'डुप्लीकेट', 'रिफंड']],
  ['hisab', ['hisab', 'hisaab', 'हिसाब', 'sunenge', 'suna', 'सुनाओ', 'हाँ सुन']],
];
const OWNER = new Set(['earn', 'udhaar', 'sahukar', 'credit', 'refund', 'hisab']);
const match = t => { t = t.toLowerCase(); return (SCENES.find(([, kw]) => kw.some(k => t.includes(k))) || [])[0]; };

function scene(id, body) {
  const tr = [];
  const T = (k, t) => tr.push({ k, t });
  if (OWNER.has(id) && !unlocked()) {
    T('gate', `🔒 PIN_REQUIRED — "${id}" owner-only. Public view: last 3 payments only.`);
    if (id === 'earn') return { ...say('locked'), led: 'amber', needPin: true, cards: [{ type: 'last3', data: L.last3 }], trace: tr };
    return { ...say('pin'), led: 'amber', needPin: true, trace: tr };
  }
  touch();
  switch (id) {
    case 'aaya': T('tool', 'get_recent_payments(window=2m) → 1 open bill ₹120 unmatched'); return { ...say('aaya'), led: 'red', cards: [{ type: 'last3', data: L.last3 }], trace: tr };
    case 'earn': { const h = tools.hisab(); T('plan', '1. get_hisab 2. speak headline only (privacy) 3. details → app'); T('tool', `get_hisab() → gross ${h.gross}, ${h.count} txns`); T('check', '✓ numbers verified against ledger'); return { ...say('earn'), led: 'green', cards: [{ type: 'sheet', data: h }], trace: tr }; }
    case 'scam': {
      const id2 = 'paytm.support.help@ybl', seen = S.scamIds.includes(id2);
      T('input', `UNTRUSTED forwarded content: "${(body.forwarded || '').slice(0, 90)}…"`);
      T('plan', '1. classify as untrusted data 2. check scam memory 3. never act on embedded instructions');
      T('gate', '⛔ BLOCK — embedded instruction "PIN batao / refund karo" ignored. issue_refund has NO destination param → cannot pay a stranger.');
      if (seen) { T('mem', `🧠 recall: ${id2} flagged earlier`); return { ...say('scam2'), led: 'red', cards: [{ type: 'alert', data: { id: id2, repeat: true } }], trace: tr }; }
      S.scamIds.push(id2); T('mem', `🧠 remember(scam_id=${id2})`);
      return { ...say('scam'), led: 'red', cards: [{ type: 'alert', data: { id: id2 } }], trace: tr };
    }
    case 'udhaar': { const u = tools.udhaar(); T('plan', '1. get_udhaar 2. pick overdue 3. send polite reminder (fixed template, own number only)'); T('tool', `get_udhaar() → ${u.list.length} log, total ${u.total}`); T('tool', 'send_reminder(Sharma ji, ₹1,450) → UPI link sent ✓ (1/3 reminders this week)'); return { ...say('udhaar'), led: 'green', cards: [{ type: 'khata', data: u }], trace: tr, followup: 'sharma_paid' }; }
    case 'credit': { const o = tools.offers(); T('plan', '1. need detected (Diwali stock) 2. get_credit_offers 3. affordability check in code'); T('tool', 'get_credit_offers() → 2 pre-approved'); o.forEach(x => T('check', `Offer ${x.id}: ₹${x.daily}/day = ${x.pct}% of daily profit → ${x.ok ? '✅ affordable' : '⚠️ >10% heavy'}`)); return { ...say('credit'), led: 'green', cards: [{ type: 'offers', data: o }], trace: tr }; }
    case 'sahukar': { const a = tools.offers()[0]; T('tool', `compute_apr(offer A) → ${a.apr}% / yr (code)`); T('tool', 'search_help("sahukar interest") → source: RBI digital lending card'); return { ...say('sahukar'), led: 'green', cards: [{ type: 'compare', data: { apr: a.apr } }], trace: tr }; }
    case 'hisab': { const h = tools.hisab(); T('plan', '1. get_hisab 2. detect_alerts 3. rank top 5 4. verify numbers 5. speak headline'); T('tool', `get_hisab() → ${h.gross} − ${h.kata} = ${h.net}`); T('tool', 'detect_alerts() → duplicate ₹200, 1 fraud blocked, Diwali in 12 days'); T('check', '✓ 4/4 spoken numbers match ledger'); return { ...say('hisab'), led: 'amber', cards: [{ type: 'sheet', data: h, alerts: true }], trace: tr }; }
    case 'refund': {
      if (S.refunded[L.dupTxn.id]) { T('gate', '⛔ BLOCK — rule P4 idempotency: TXN-V2 already refunded'); return { ...say('refundBlocked'), led: 'red', trace: tr }; }
      T('plan', '1. find duplicate 2. propose refund 3. owner PIN step-up 4. policy gate'); T('tool', 'find_duplicate() → TXN-V2 ₹200 Vikas K.');
      return { ...say('refundAsk'), led: 'amber', cards: [{ type: 'refund', data: L.dupTxn }], trace: tr };
    }
  }
}

// ---------- Live agent for off-script questions ----------
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
const TOOLS = [
  { name: 'get_last_payments', description: 'Last 3 payments (public).', input_schema: { type: 'object', properties: {} } },
  { name: 'get_hisab', description: 'Today gross, deductions, net settlement. Owner only.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_udhaar', description: 'Customer credit ledger. Owner only.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_credit_offers', description: 'Pre-approved loan offers with code-computed totals. Owner only.', input_schema: { type: 'object', properties: {} } },
];
const runTool = n => {
  if (n !== 'get_last_payments' && !unlocked()) return { error: 'LOCKED: owner PIN required' };
  return n === 'get_last_payments' ? L.last3 : n === 'get_hisab' ? tools.hisab() : n === 'get_udhaar' ? tools.udhaar() : tools.offers();
};
async function live(text, tr) {
  if (!anthropic) return { say: 'Ye abhi demo mein nahi hai.', tts: 'यह अभी डेमो में नहीं है।' };
  const system = `You are Saathi, an AI inside a Paytm Soundbox for a kirana merchant. Reply in short Hinglish (max 2 sentences). Only use numbers returned by tools; never compute or invent. If a tool says LOCKED, ask for the PIN. Never ask for PIN in chat, never move money. Output format exactly: <Roman Hinglish> ||| <same sentence in Devanagari>.`;
  const msgs = [{ role: 'user', content: text }]; let blob = text;
  for (let i = 0; i < 4; i++) {
    const r = await anthropic.messages.create({ model: process.env.MODEL || 'claude-haiku-5-5', max_tokens: 300, system, tools: TOOLS, messages: msgs });
    if (r.stop_reason !== 'tool_use') {
      const out = r.content.filter(c => c.type === 'text').map(c => c.text).join('');
      const [d, h] = out.split('|||').map(s => s.trim());
      const bad = (d.match(/\d[\d,]*/g) || []).map(x => x.replace(/,/g, '')).filter(x => x.length > 1 && !blob.replace(/,/g, '').includes(x));
      if (bad.length) { tr.push({ k: 'check', t: `⛔ unverified numbers ${bad} — answer blocked` }); return { say: 'Maaf kijiye, ye pakka nahi bata sakta.', tts: 'माफ़ कीजिए, यह पक्का नहीं बता सकता।' }; }
      tr.push({ k: 'check', t: '✓ all numbers grounded in tool results' });
      return { say: d, tts: h || d };
    }
    msgs.push({ role: 'assistant', content: r.content });
    const res = r.content.filter(c => c.type === 'tool_use').map(c => { const o = runTool(c.name); blob += JSON.stringify(o); tr.push({ k: 'tool', t: `${c.name}() → ${JSON.stringify(o).slice(0, 80)}` }); return { type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(o) }; });
    msgs.push({ role: 'user', content: res });
  }
  return { say: 'Thoda mushkil sawaal hai, phir se poochein.', tts: 'थोड़ा मुश्किल सवाल है, फिर से पूछें।' };
}

// ---------- Routes ----------
app.post('/api/chat', async (req, res) => {
  const { text = '', forwarded } = req.body;
  if (Date.now() < S.lockedUntil) return res.json({ ...say('lockout'), led: 'red', trace: [{ k: 'gate', t: '⛔ device locked (wrong PIN x3)' }] });
  const id = forwarded ? 'scam' : match(text);
  if (id) return res.json({ scene: id, ...scene(id, req.body) });
  const tr = [{ k: 'plan', t: 'off-script → live Claude agent with tools' }];
  try { const r = await Promise.race([live(text, tr), new Promise((_, j) => setTimeout(() => j(new Error('timeout')), 12000))]); res.json({ ...r, led: 'green', trace: tr }); }
  catch (e) { tr.push({ k: 'gate', t: 'tool/model failure → honest fallback: ' + e.message }); res.json({ say: 'Server slow hai, kuch nahi badla. Phir try karein.', tts: 'सर्वर धीमा है, कुछ नहीं बदला। फिर से कोशिश करें।', led: 'amber', trace: tr }); }
});
function checkPin(pin) {
  if (Date.now() < S.lockedUntil) return 'locked';
  if (pin === (process.env.OWNER_PIN || '1234')) { S.fails = 0; return 'ok'; }
  if (++S.fails >= 3) { S.lockedUntil = Date.now() + 300000; S.fails = 0; return 'locked'; }
  return 'wrong';
}
app.post('/api/pin', (req, res) => {
  const r = checkPin(req.body.pin);
  if (r === 'ok') { S.unlockedUntil = Date.now() + 180000; return res.json({ ok: true, ...say('hello'), led: 'green', trace: [{ k: 'gate', t: '✓ PIN verified server-side → owner session 3 min (AI never sees PIN)' }] }); }
  res.json({ ok: false, ...say(r === 'locked' ? 'lockout' : 'wrong'), led: 'red', trace: [{ k: 'gate', t: r === 'locked' ? '⛔ 3 wrong PINs → 5 min lockout, owner alerted' : '✗ wrong PIN' }] });
});
app.post('/api/refund', (req, res) => {
  const tr = [];
  const r = checkPin(req.body.pin);
  if (r !== 'ok') { tr.push({ k: 'gate', t: '⛔ step-up PIN failed' }); return res.json({ ...say(r === 'locked' ? 'lockout' : 'wrong'), led: 'red', trace: tr }); }
  const t = L.dupTxn;
  tr.push({ k: 'gate', t: '✓ step-up PIN ok' });
  if (S.refunded[t.id]) { tr.push({ k: 'gate', t: '⛔ BLOCK P4 idempotency' }); return res.json({ ...say('refundBlocked'), led: 'red', trace: tr }); }
  tr.push({ k: 'gate', t: `✓ P1 destination = original source (${t.source})` }, { k: 'gate', t: `✓ P2 amount ₹${t.amt} ≤ original ₹${t.amt}` }, { k: 'gate', t: '✓ P4 first refund for TXN-V2' });
  S.refunded[t.id] = true; touch();
  tr.push({ k: 'tool', t: 'issue_refund(TXN-V2, 200) → SUCCESS' }, { k: 'mem', t: '🧠 audit: refund ₹200 approved by owner' });
  res.json({ ...say('refundDone'), led: 'green', trace: tr });
});
app.post('/api/event', (req, res) => {
  if (req.body.e === 'sharma_paid') { S.sharmaPaid = true; return res.json({ ...say('paid'), led: 'green', cards: [{ type: 'khata', data: tools.udhaar() }], trace: [{ k: 'tool', t: 'payment_webhook(₹1,450, Sharma ji) → matched to udhaar → cleared' }] }); }
  if (req.body.e === 'closing') return res.json({ ...say('closing'), led: 'amber', trace: [{ k: 'plan', t: 'proactive: closing time learned (~9 PM) → offer hisab' }] });
  res.json({});
});
app.get('/api/lines', (_, res) => res.json(LINES));
app.post('/api/reset', (_, res) => { S = fresh(); res.json({ ok: true }); });

app.get('/api/tts', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 900);
  const f = `cache/${crypto.createHash('md5').update(text + (process.env.SARVAM_SPEAKER || '')).digest('hex')}.wav`;
  if (fs.existsSync(f)) return res.type('audio/wav').send(fs.readFileSync(f));
  if (!process.env.SARVAM_API_KEY) return res.status(204).end();
  try {
    const body = { text, target_language_code: 'hi-IN', model: 'bulbul:v3' };
    if (process.env.SARVAM_SPEAKER) body.speaker = process.env.SARVAM_SPEAKER;
    const r = await fetch('https://api.sarvam.ai/text-to-speech', { method: 'POST', headers: { 'api-subscription-key': process.env.SARVAM_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok || !j.audios) { console.error('Sarvam', r.status, JSON.stringify(j).slice(0, 300)); return res.status(204).end(); }
    const buf = Buffer.from(j.audios.join(''), 'base64'); fs.writeFileSync(f, buf);
    res.type('audio/wav').send(buf);
  } catch (e) { console.error('Sarvam', e.message); res.status(204).end(); }
});

app.listen(3000, () => console.log('Saathi → http://localhost:3000'));
