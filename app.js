/* ألو بوطة: تطبيق الويب (زبون، شاب، إدارة) فوق Supabase */
(function () {
'use strict';
const CFG = window.ALO_CONFIG || {};
const sb = (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase)
  ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

const DEF = { commission_pct: 10, bottle_price: 50, min_fee: 10 };
const ST = { new: 'جديد', accepted: 'قبله شاب', picked: 'القنينة مع الشاب', delivered: 'تم التسليم', cancelled: 'ملغى' };
const BADGE = { new: '', accepted: 'info', picked: 'info', delivered: 'ok', cancelled: 'bad' };
const ACTIVE = ['new', 'accepted', 'picked'];
const TXK = { topup: 'شحن الرصيد', accept_hold: 'حجز ثمن القنينة', release: 'استرجاع ثمن القنينة', commission: 'عمولة التطبيق', refund: 'استرجاع بعد إلغاء' };
const ERR = {
  not_authenticated: 'سجّل الدخول من جديد.', invalid_input: 'تأكد من البيانات المدخلة.',
  already_registered: 'هذا الحساب مسجل بدور آخر.', not_a_customer: 'هذا الحساب ليس حساب زبون.',
  invalid_fee: 'الأجرة خارج الحد المسموح.', active_order_exists: 'لديك طلب قيد التنفيذ.',
  not_approved_youth: 'حسابك لم يُعتمد بعد.', not_available: 'فعّل التوفر لقبول الطلبات.',
  order_taken: 'شاب آخر قبل هذا الطلب.', finish_current_job: 'أنهِ مهمتك الحالية أولاً.',
  low_wallet: 'رصيدك لا يكفي لثمن القنينة.', invalid_state: 'لا يمكن تنفيذ هذه الخطوة الآن.', not_allowed: 'غير مسموح.'
};

const S = {
  ready: false, session: null, profile: null, settings: { ...DEF }, orders: [], contacts: {}, tx: [], youths: [], customersCount: 0,
  cview: 'order', aview: 'overview', afilter: 'all', regRole: null, authMode: 'login',
  form: { floor: 1, fee: null, touched: false }, busy: false, loadedFor: null, channel: null
};

/* ---------- أدوات ---------- */
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const money = n => r2(n) + ' درهم';
const sum = (a, f) => a.reduce((t, x) => t + (Number(f(x)) || 0), 0);
const byNew = (a, b) => (b.created_at || '').localeCompare(a.created_at || '');
const dayKey = iso => { try { return new Date(iso).toLocaleDateString('en-CA'); } catch (e) { return ''; } };
const todayKey = () => new Date().toLocaleDateString('en-CA');
const tm = iso => { try { const d = new Date(iso); return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
const net = o => r2((o.fee || 0) - (o.commission || 0));

function normPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('212')) d = '0' + d.slice(3);
  return /^0[5-7]\d{8}$/.test(d) ? d : null;
}
const phoneEmail = p => p + '@alobutta.app';
const myPhone = () => (S.session && S.session.user.email ? S.session.user.email.split('@')[0] : '');
const uid = () => (S.session ? S.session.user.id : null);

function errText(e) {
  const m = (e && e.message) || '';
  for (const k in ERR) if (m.indexOf(k) !== -1) return ERR[k];
  if (/Invalid login/i.test(m)) return 'رقم الهاتف أو كلمة السر غير صحيحة.';
  if (/already registered/i.test(m)) return 'هذا الرقم مسجل، اختر دخول.';
  if (/Password should be/i.test(m)) return 'كلمة السر قصيرة (6 أحرف على الأقل).';
  if (/rate limit/i.test(m)) return 'محاولات كثيرة، انتظر قليلاً.';
  if (/fetch|network/i.test(m)) return 'تعذر الاتصال بالإنترنت.';
  return 'حدث خطأ، حاول مرة أخرى.';
}

function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat(9)) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return e;
}
function bottleSvg() {
  const d = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  d.setAttribute('width', '22'); d.setAttribute('height', '22'); d.setAttribute('viewBox', '0 0 24 24'); d.setAttribute('fill', 'none');
  d.setAttribute('stroke', 'currentColor'); d.setAttribute('stroke-width', '1.9'); d.setAttribute('stroke-linecap', 'round'); d.setAttribute('stroke-linejoin', 'round'); d.setAttribute('aria-hidden', 'true');
  d.innerHTML = '<path d="M9 3h6"/><path d="M10 3v2M14 3v2"/><path d="M7 9a5 5 0 0 1 5-4 5 5 0 0 1 5 4v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z"/><path d="M7 12h10"/>';
  return d;
}
let TT;
function toast(msg) { const t = document.getElementById('toast'); t.firstChild.textContent = msg; t.classList.add('on'); clearTimeout(TT); TT = setTimeout(() => t.classList.remove('on'), 3200); }
const editing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'SELECT'); };
let RT; function sched() { clearTimeout(RT); RT = setTimeout(() => { if (editing()) { sched(); return; } render(); }, 150); }
const val = id => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
function setErr(m) { const e = document.getElementById('err'); if (e) e.textContent = m || ''; }
async function call(fn, args) {
  const { error } = await sb.rpc(fn, args || {});
  if (error) throw error;
}
async function act(fn, args, okMsg) {
  if (S.busy) return false;
  S.busy = true;
  try { await call(fn, args); if (okMsg) toast(okMsg); await loadAll(); S.busy = false; render(); return true; }
  catch (e) { S.busy = false; toast(errText(e)); await loadAll().catch(() => {}); render(); return false; }
}

/* ---------- الهيكل ---------- */
function render() {
  const root = document.getElementById('app'); const y = window.scrollY;
  const role = S.profile && S.profile.role;
  const wide = role === 'admin';
  const header = h('div', { class: 'top' },
    h('div', { class: 'brand' }, h('span', { class: 'logo' }, bottleSvg()), 'ألو بوطة'),
    S.session ? h('button', { class: 'link', type: 'button', onclick: logout }, 'خروج') : null);
  let body;
  if (!sb) body = setupNeeded();
  else if (!S.ready) body = h('div', { class: 'empty' }, 'جارٍ التحميل…');
  else if (!S.session) body = authView();
  else if (!S.profile) body = registerView();
  else if (role === 'admin') body = adminView();
  else if (role === 'youth') body = youthView();
  else body = customerView();
  const foot = h('div', { class: 'footer' }, h('a', { href: 'privacy.html' }, 'سياسة الخصوصية'), h('a', { href: 'terms.html' }, 'شروط الاستخدام'));
  root.replaceChildren(h('div', { class: 'wrap' + (wide ? ' wide' : '') }, header, body, foot));
  window.scrollTo(0, y);
}
function setupNeeded() {
  return h('div', { class: 'card' }, h('h1', null, 'التطبيق غير مربوط بقاعدة البيانات'),
    h('p', { class: 'muted' }, 'افتح الملف config.js وضع عنوان مشروع Supabase والمفتاح العام، كما في ملف الخطوات.'));
}
async function logout() {
  try { await sb.auth.signOut(); } catch (e) {}
  S.session = null; S.profile = null; S.orders = []; S.contacts = {}; S.tx = []; S.youths = []; S.loadedFor = null;
  if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
  render();
}

/* ---------- الدخول والتسجيل ---------- */
function field(id, label, o) {
  o = o || {};
  return h('div', { class: 'field' }, h('label', { for: id }, label),
    h('input', { id, type: o.type || 'text', dir: o.dir, autocomplete: o.ac || 'off', inputmode: o.mode, value: o.value || '', minlength: o.min, maxlength: o.max }));
}
function authView() {
  const login = S.authMode === 'login';
  return h('div', { class: 'list' },
    h('div', { class: 'hero' }, h('h1', null, login ? 'أهلاً بك' : 'حساب جديد'),
      h('p', { class: 'muted' }, login ? 'سجّل الدخول لتطلب بوطتك أو تقبل الطلبات.' : 'رقم هاتفك وكلمة سر تكفي.')),
    h('div', { class: 'card' },
      field('a-phone', 'رقم الهاتف', { type: 'tel', dir: 'ltr', ac: 'tel', mode: 'tel' }),
      field('a-pass', 'كلمة السر', { type: 'password', ac: login ? 'current-password' : 'new-password', min: 6 }),
      h('div', { class: 'err', id: 'err', role: 'alert' }),
      h('button', { class: 'btn', type: 'button', disabled: S.busy, onclick: submitAuth }, login ? 'دخول' : 'إنشاء الحساب'),
      h('button', { class: 'link', type: 'button', onclick: () => { S.authMode = login ? 'signup' : 'login'; render(); } }, login ? 'ليس لدي حساب' : 'لدي حساب')));
}
async function submitAuth() {
  const phone = normPhone(val('a-phone')); const pass = document.getElementById('a-pass').value;
  if (!phone) return setErr('اكتب رقماً مغربياً صحيحاً، مثل 0612345678.');
  if (pass.length < 6) return setErr('كلمة السر 6 أحرف على الأقل.');
  S.busy = true; render();
  try {
    if (S.authMode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email: phoneEmail(phone), password: pass });
      if (error) throw error;
      if (!data.session) { S.busy = false; render(); setErr('تم إنشاء الحساب. فعّل الدخول من لوحة التحكم (إيقاف تأكيد البريد) ثم سجّل الدخول.'); return; }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email: phoneEmail(phone), password: pass });
      if (error) throw error;
    }
  } catch (e) { S.busy = false; render(); setErr(errText(e)); }
  S.busy = false;
}
function registerView() {
  if (!S.regRole) {
    return h('div', { class: 'list' }, h('div', { class: 'hero' }, h('h1', null, 'كيف تريد استعمال التطبيق؟')),
      h('button', { class: 'btn', type: 'button', onclick: () => { S.regRole = 'customer'; render(); } }, 'أنا زبون، أريد بوطة'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { S.regRole = 'youth'; render(); } }, 'أنا شاب، أريد العمل'));
  }
  const cust = S.regRole === 'customer';
  return h('div', { class: 'card' }, h('h1', null, cust ? 'بيانات التوصيل' : 'اربح من حيّك'),
    h('p', { class: 'muted' }, cust ? 'نحتاجها مرة واحدة فقط.' : 'ستراجع الإدارة بياناتك قبل اعتماد الحساب.'),
    field('r-name', 'الاسم الكامل', { ac: 'name', max: 60 }),
    field('r-hood', 'الحي والمدينة', { max: 60 }),
    cust ? field('r-addr', 'العنوان (الشارع، العمارة، الطابق)', { max: 120 }) : null,
    cust ? null : h('label', { class: 'check', for: 'r-terms' }, h('input', { id: 'r-terms', type: 'checkbox' }),
      h('span', null, 'أوافق على شروط الاستخدام، وأتحمل مسؤولية تركيب القنينة وفحص الوصلة قبل التسليم.')),
    h('div', { class: 'err', id: 'err', role: 'alert' }),
    h('button', { class: 'btn', type: 'button', disabled: S.busy, onclick: submitRegister }, 'إنشاء الحساب'),
    h('button', { class: 'link', type: 'button', onclick: () => { S.regRole = null; render(); } }, 'رجوع'));
}
async function submitRegister() {
  const cust = S.regRole === 'customer';
  const name = val('r-name'), hood = val('r-hood'), addr = val('r-addr');
  if (name.length < 2 || hood.length < 2 || (cust && addr.length < 3)) return setErr('أكمل كل الحقول.');
  if (!cust && !document.getElementById('r-terms').checked) return setErr('وافق على الشروط للمتابعة.');
  S.busy = true;
  try {
    if (cust) await call('register_customer', { p_name: name, p_phone: myPhone(), p_hood: hood, p_address: addr });
    else await call('register_youth', { p_name: name, p_phone: myPhone(), p_hood: hood });
    await afterLogin(true); S.busy = false; toast('تم إنشاء حسابك'); render();
  } catch (e) { S.busy = false; setErr(errText(e)); }
}

/* ---------- مكونات مشتركة ---------- */
function stepper(label, value, onMinus, onPlus, note) {
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', { class: 'muted' }, label),
    h('div', { class: 'step' }, h('button', { type: 'button', 'aria-label': 'إنقاص ' + label, onclick: onMinus }, '−'), h('b', { class: 'num' }, value),
      h('button', { type: 'button', 'aria-label': 'زيادة ' + label, onclick: onPlus }, '+'))),
    note ? h('span', { class: 'muted' }, note) : null);
}
function timeline(o) {
  const labels = ['تم إرسال الطلب', 'قبل الشاب طلبك', 'القنينة الممتلئة مع الشاب', 'تم التسليم'];
  const idx = { new: 0, accepted: 1, picked: 2, delivered: 3 }[o.status] ?? 0;
  const out = [];
  labels.forEach((l, i) => {
    const st = i < idx || o.status === 'delivered' ? 'done' : i === idx ? 'now' : '';
    out.push(h('div', null, h('span', { class: 'dot ' + st }, st === 'done' ? '✓' : i + 1),
      h('b', { style: i > idx && o.status !== 'delivered' ? 'color:var(--muted);font-weight:400' : '' }, l)));
    if (i < labels.length - 1) out.push(h('div', { class: 'line ' + (i < idx || o.status === 'delivered' ? 'done' : '') }));
  });
  return h('div', { class: 'tl' }, out);
}
const phoneLine = p => h('div', { class: 'num', dir: 'ltr', style: 'text-align:right' }, h('a', { href: 'tel:' + p, style: 'color:var(--accent);font-weight:600' }, p));

/* ---------- الزبون ---------- */
function customerView() {
  const mine = S.orders.filter(o => o.customer_id === uid()).sort(byNew);
  const active = mine.find(o => ACTIVE.includes(o.status));
  const tabs = h('div', { class: 'tabs' }, [['order', 'طلب بوطة'], ['history', 'طلباتي']].map(([k, l]) =>
    h('button', { class: 'chip', type: 'button', 'aria-pressed': String(S.cview === k), onclick: () => { S.cview = k; render(); } }, l)));
  if (S.cview === 'history') return h('div', { class: 'list' }, tabs, mine.length ? mine.map(o => orderCard(o)) :
    h('div', { class: 'empty' }, h('b', null, 'لا توجد طلبات بعد'), h('span', null, 'عندما تطلب بوطة ستظهر هنا.')));
  return h('div', { class: 'list' }, tabs, active ? tracking(active) : orderForm());
}
function sugFee(f) { return S.settings.min_fee + 2 * Math.max(0, f - 1); }
function orderForm() {
  const F = S.form, st = S.settings, me = S.profile; const sug = sugFee(F.floor); if (!F.touched) F.fee = sug;
  const fee = Math.max(st.min_fee, F.fee); const total = Number(st.bottle_price) + fee;
  return h('div', { class: 'list' },
    h('div', null, h('h1', null, 'قنينتك فارغة؟'), h('p', { class: 'muted' }, 'اطلبها ممتلئة حتى باب البيت، بدون ما تنزل.')),
    stepper('الطابق', F.floor === 0 ? 'أرضي' : F.floor, () => { F.floor = Math.max(0, F.floor - 1); render(); }, () => { F.floor = Math.min(15, F.floor + 1); render(); }),
    stepper('أجرة الشاب', money(fee), () => { F.touched = true; F.fee = Math.max(st.min_fee, fee - 1); render(); }, () => { F.touched = true; F.fee = Math.min(200, fee + 1); render(); },
      'الحد الأدنى ' + money(st.min_fee) + '. المقترح لهذا الطابق: ' + money(sug) + '.'),
    h('div', { class: 'soft' },
      h('div', { class: 'row' }, h('span', null, 'ثمن القنينة'), h('span', { class: 'num' }, money(st.bottle_price))),
      h('div', { class: 'row' }, h('span', null, 'أجرة الشاب'), h('span', { class: 'num' }, money(fee))),
      h('div', { class: 'row', style: 'font-size:19px;font-weight:700' }, h('span', null, 'المجموع'), h('span', { class: 'num' }, money(total))),
      h('span', { style: 'font-size:14px' }, 'الدفع نقداً عند التسليم.')),
    h('div', { class: 'muted' }, 'التوصيل إلى: ' + (me.address || '') + ' — ' + me.hood),
    h('div', { class: 'err', id: 'err', role: 'alert' }),
    h('button', { class: 'btn', type: 'button', disabled: S.busy, onclick: async () => {
      const ok = await act('create_order', { p_floor: F.floor, p_fee: fee }, 'تم إرسال طلبك'); if (ok) F.touched = false;
    } }, 'اطلب ألو بوطة'));
}
function tracking(o) {
  const c = S.contacts[o.id] || {};
  const msg = { new: 'نبحث عن شاب قريب منك…', accepted: 'الشاب في الطريق إلى البقال.', picked: 'القنينة الممتلئة معه وهو قادم إليك.' }[o.status];
  return h('div', { class: 'list' }, h('div', null, h('h1', null, 'طلبك قيد التنفيذ'), h('p', { class: 'muted' }, msg)),
    o.youth_name ? h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', null, o.youth_name), h('span', { class: 'badge info' }, 'شاب من حيك')), c.youth_phone ? phoneLine(c.youth_phone) : null) : null,
    h('div', { class: 'card' }, timeline(o)),
    h('div', { class: 'soft' }, h('div', { class: 'row' }, h('span', null, 'المبلغ نقداً عند التسليم'), h('b', { class: 'num' }, money(Number(o.bottle_price) + Number(o.fee)))),
      h('span', { style: 'font-size:14px' }, money(o.bottle_price) + ' ثمن القنينة + ' + money(o.fee) + ' أجرة')),
    o.status === 'new' ? h('button', { class: 'btn bad', type: 'button', disabled: S.busy, onclick: () => act('cancel_order', { p_order: o.id }, 'تم إلغاء الطلب') }, 'إلغاء الطلب') : null);
}
function orderCard(o) {
  return h('div', { class: 'item' }, h('div', { class: 'row' }, h('b', null, tm(o.created_at)), h('span', { class: 'badge ' + BADGE[o.status] }, ST[o.status])),
    h('div', { class: 'muted' }, (o.youth_name ? 'الشاب: ' + o.youth_name + ' — ' : '') + 'الطابق ' + (o.floor || 'الأرضي') + ' — ' + money(Number(o.bottle_price) + Number(o.fee))));
}

/* ---------- الشاب ---------- */
function youthView() {
  const me = S.profile;
  if (me.status === 'pending') return h('div', { class: 'card' }, h('h1', null, 'طلبك قيد المراجعة'), h('p', { class: 'muted' }, 'ستعتمد الإدارة حسابك قريباً، وبعدها تظهر لك الطلبات.'));
  if (me.status === 'suspended') return h('div', { class: 'card' }, h('h1', null, 'الحساب موقوف'), h('p', { class: 'muted' }, 'تواصل مع الإدارة لمعرفة السبب.'));
  const job = S.orders.find(o => o.youth_id === uid() && ['accepted', 'picked'].includes(o.status));
  const done = S.orders.filter(o => o.youth_id === uid() && o.status === 'delivered');
  const doneT = done.filter(o => dayKey(o.delivered_at) === todayKey());
  const wallet = h('div', { class: 'card' }, h('div', { class: 'row' },
    h('div', null, h('div', { class: 'muted' }, 'رصيدك في التطبيق'), h('b', { class: 'num big' }, money(me.wallet))),
    h('button', { class: 'btn sm ghost', type: 'button', onclick: () => act('set_youth_active', { p_active: !me.active }) }, me.active ? 'متاح للطلبات' : 'غير متاح، فعّل')),
    h('span', { class: 'muted' }, 'عند قبول الطلب يُحجز ثمن القنينة (' + money(S.settings.bottle_price) + ') ويعود إليك عند التسليم. لشحن الرصيد تواصل مع الإدارة.'));
  let main;
  if (job) main = jobCard(job);
  else if (!me.active) main = h('div', { class: 'empty' }, h('b', null, 'أنت غير متاح حالياً'), h('span', null, 'فعّل زر التوفر لترى الطلبات.'));
  else {
    const list = S.orders.filter(o => o.status === 'new').sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    main = h('div', { class: 'list' }, h('h2', null, 'طلبات قريبة منك'),
      list.length ? list.map(newJob) : h('div', { class: 'empty' }, h('b', null, 'لا توجد طلبات الآن'), h('span', null, 'ستظهر الطلبات الجديدة هنا مباشرة.')));
  }
  return h('div', { class: 'list' }, wallet, main,
    h('div', { class: 'grid' },
      h('div', { class: 'kpi' }, h('span', { class: 'muted' }, 'تسليمات اليوم'), h('b', null, doneT.length)),
      h('div', { class: 'kpi' }, h('span', { class: 'muted' }, 'ربحك اليوم'), h('b', null, money(sum(doneT, net)))),
      h('div', { class: 'kpi' }, h('span', { class: 'muted' }, 'ربحك الإجمالي'), h('b', null, money(sum(done, net))))),
    S.tx.length ? h('div', { class: 'card' }, h('h3', null, 'آخر حركات الرصيد'),
      S.tx.map(t => h('div', { class: 'row' }, h('span', { class: 'muted' }, tm(t.created_at) + ' — ' + (TXK[t.kind] || t.kind)),
        h('b', { class: 'num', dir: 'ltr' }, (t.amount > 0 ? '+' : '') + r2(t.amount))))) : null);
}
function newJob(o) {
  const me = S.profile; const comm = r2(o.fee * o.commission_pct / 100); const low = Number(me.wallet) < Number(o.bottle_price);
  return h('div', { class: 'item' }, h('div', { class: 'row' }, h('b', null, o.hood + ' — الطابق ' + (o.floor || 'الأرضي')), h('span', { class: 'muted' }, tm(o.created_at))),
    h('div', { class: 'soft' }, h('div', { class: 'row' }, h('span', null, 'أجرة الطلب ' + money(o.fee)), h('b', { class: 'num', style: 'font-size:18px' }, 'تربح ' + money(o.fee - comm))),
      h('span', { style: 'font-size:13px' }, 'عمولة التطبيق ' + money(comm))),
    h('button', { class: 'btn', type: 'button', disabled: low || S.busy, onclick: () => act('accept_order', { p_order: o.id }, 'قبلت الطلب. اذهب إلى البقال.') }, low ? 'رصيدك لا يكفي' : 'اقبل الطلب'),
    h('span', { class: 'muted' }, low ? 'تحتاج ' + money(o.bottle_price) + ' في رصيدك. اشحنه عند الإدارة.' : 'العنوان ورقم الزبون يظهران بعد قبول الطلب.'));
}
function jobCard(o) {
  const c = S.contacts[o.id] || {}; const comm = r2(o.fee * o.commission_pct / 100);
  return h('div', { class: 'list' }, h('h2', null, 'مهمتك الحالية'),
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', null, o.customer_name), h('span', { class: 'badge ' + BADGE[o.status] }, ST[o.status])),
      c.customer_phone ? phoneLine(c.customer_phone) : null,
      h('div', null, (c.address || '') + ' — ' + o.hood + ' — الطابق ' + (o.floor || 'الأرضي')),
      timeline(o),
      h('div', { class: 'soft' }, h('div', { class: 'row' }, h('span', null, 'تستلم من الزبون نقداً'), h('b', { class: 'num' }, money(Number(o.bottle_price) + Number(o.fee)))),
        h('span', { style: 'font-size:13px' }, 'منها ربحك ' + money(o.fee - comm) + ' بعد العمولة.')),
      o.status === 'accepted'
        ? h('button', { class: 'btn', type: 'button', disabled: S.busy, onclick: () => act('pick_order', { p_order: o.id }) }, 'أخذت القنينة الممتلئة من البقال')
        : h('button', { class: 'btn', type: 'button', disabled: S.busy, onclick: () => act('deliver_order', { p_order: o.id }, 'تم التسليم') }, 'سلّمت القنينة وقبضت المبلغ')));
}

/* ---------- الإدارة ---------- */
function adminView() {
  const tabs = h('div', { class: 'tabs' }, [['overview', 'نظرة عامة'], ['orders', 'الطلبات'], ['youths', 'الشباب'], ['settings', 'الإعدادات']].map(([k, l]) =>
    h('button', { class: 'chip', type: 'button', 'aria-pressed': String(S.aview === k), onclick: () => { S.aview = k; render(); } }, l)));
  const v = { overview: adminOverview, orders: adminOrders, youths: adminYouths, settings: adminSettings }[S.aview]();
  return h('div', { class: 'list' }, tabs, v);
}
function adminOverview() {
  const O = S.orders; const del = O.filter(o => o.status === 'delivered'); const t = todayKey();
  const delT = del.filter(o => dayKey(o.delivered_at) === t); const act = O.filter(o => ACTIVE.includes(o.status));
  const days = []; for (let i = 6; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5); const k = d.toLocaleDateString('en-CA'); days.push({ k, c: sum(del.filter(o => dayKey(o.delivered_at) === k), o => o.commission), lbl: k.slice(8) + '/' + k.slice(5, 7) }); }
  const mx = Math.max(1, ...days.map(x => x.c)); const pending = S.youths.filter(y => y.status === 'pending').length;
  return h('div', { class: 'list' }, h('div', { class: 'grid' },
    h('div', { class: 'kpi main' }, h('span', null, 'عمولتك اليوم'), h('b', null, money(sum(delT, o => o.commission)))),
    h('div', { class: 'kpi main' }, h('span', null, 'عمولتك الإجمالية'), h('b', null, money(sum(del, o => o.commission)))),
    h('div', { class: 'kpi' }, h('span', { class: 'muted' }, 'تسليمات اليوم'), h('b', null, delT.length)),
    h('div', { class: 'kpi' }, h('span', { class: 'muted' }, 'قيد التنفيذ'), h('b', null, act.length)),
    h('div', { class: 'kpi' }, h('span', { class: 'muted' }, 'مبيعات الزبناء'), h('b', null, money(sum(del, o => Number(o.bottle_price) + Number(o.fee))))),
    h('div', { class: 'kpi' }, h('span', { class: 'muted' }, 'أرباح الشباب'), h('b', null, money(sum(del, net)))),
    h('div', { class: 'kpi' }, h('span', { class: 'muted' }, 'الشباب المعتمدون'), h('b', null, S.youths.filter(y => y.status === 'approved').length)),
    h('div', { class: 'kpi' }, h('span', { class: 'muted' }, 'الزبناء'), h('b', null, S.customersCount))),
    pending ? h('div', { class: 'soft' }, h('b', null, pending + ' شاب ينتظرون الاعتماد'), h('button', { class: 'btn sm', type: 'button', onclick: () => { S.aview = 'youths'; render(); } }, 'راجعهم الآن')) : null,
    h('div', { class: 'card' }, h('h3', null, 'عمولتك في آخر 7 أيام'),
      h('div', { class: 'bars', role: 'img', 'aria-label': 'عمولة كل يوم في آخر 7 أيام' }, days.map(x => h('div', { title: x.k + ': ' + money(x.c) },
        h('span', { class: 'num' }, r2(x.c)), h('i', { style: 'height:' + Math.round((x.c / mx) * 100) + 'px' }), h('span', null, x.lbl))))),
    !O.length ? h('div', { class: 'empty' }, h('b', null, 'لا توجد طلبات بعد'), h('span', null, 'ستظهر هنا عندما يطلب الزبناء.')) : null);
}
function adminOrders() {
  const fs = [['all', 'الكل'], ['new', 'جديد'], ['run', 'جارٍ'], ['delivered', 'مسلّم'], ['cancelled', 'ملغى']];
  let L = S.orders.slice().sort(byNew);
  if (S.afilter === 'new') L = L.filter(o => o.status === 'new'); else if (S.afilter === 'run') L = L.filter(o => ['accepted', 'picked'].includes(o.status));
  else if (S.afilter === 'delivered' || S.afilter === 'cancelled') L = L.filter(o => o.status === S.afilter);
  return h('div', { class: 'list' },
    h('div', { class: 'row wrap-r' }, h('div', { class: 'tabs' }, fs.map(([k, l]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(S.afilter === k), onclick: () => { S.afilter = k; render(); } }, l))),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: exportCsv }, 'تصدير CSV')),
    L.length ? L.map(o => { const c = S.contacts[o.id] || {}; return h('div', { class: 'item' },
      h('div', { class: 'row' }, h('b', null, o.customer_name + ' — ' + o.hood), h('span', { class: 'badge ' + BADGE[o.status] }, ST[o.status])),
      h('div', { class: 'muted' }, tm(o.created_at) + ' — الطابق ' + (o.floor || 'الأرضي') + ' — المجموع ' + money(Number(o.bottle_price) + Number(o.fee)) +
        (o.youth_name ? ' — الشاب: ' + o.youth_name : '') + (o.status === 'delivered' ? ' — عمولتك ' + money(o.commission) : '')),
      c.customer_phone ? h('div', { class: 'muted num', dir: 'ltr', style: 'text-align:right' }, c.customer_phone + (c.address ? ' — ' + c.address : '')) : null,
      ACTIVE.includes(o.status) ? h('div', null, h('button', { class: 'btn sm bad', type: 'button', disabled: S.busy, onclick: () => act('cancel_order', { p_order: o.id }, 'تم إلغاء الطلب') }, 'إلغاء الطلب')) : null); })
      : h('div', { class: 'empty' }, 'لا توجد طلبات في هذا القسم.'));
}
function adminYouths() {
  const L = S.youths.slice().sort(byNew);
  return h('div', { class: 'list' }, L.length ? L.map(y => {
    const b = { pending: ['', 'في الانتظار'], approved: ['ok', 'معتمد'], suspended: ['bad', 'موقوف'] }[y.status] || ['', y.status]; const tid = 'top-' + y.id;
    return h('div', { class: 'item' }, h('div', { class: 'row' }, h('b', null, y.name + ' — ' + y.hood), h('span', { class: 'badge ' + b[0] }, b[1])),
      h('div', { class: 'muted num', dir: 'ltr', style: 'text-align:right' }, y.phone),
      h('div', { class: 'row wrap-r', style: 'justify-content:flex-start' }, h('span', null, 'الرصيد: '), h('b', { class: 'num' }, money(y.wallet))),
      h('div', { class: 'row wrap-r', style: 'justify-content:flex-start' },
        y.status !== 'approved' ? h('button', { class: 'btn sm', type: 'button', onclick: () => act('admin_set_youth_status', { p_youth: y.id, p_status: 'approved' }, 'تم الاعتماد') }, 'اعتماد')
          : h('button', { class: 'btn sm ghost', type: 'button', onclick: () => act('admin_set_youth_status', { p_youth: y.id, p_status: 'suspended' }, 'تم الإيقاف') }, 'إيقاف'),
        y.status === 'approved' ? [50, 100, 200].map(n => h('button', { class: 'btn sm ghost', type: 'button', onclick: () => act('admin_topup', { p_youth: y.id, p_amount: n }, 'تم شحن ' + n + ' درهم') }, '+' + n)) : null,
        y.status === 'approved' ? [h('input', { id: tid, type: 'number', min: '1', placeholder: 'مبلغ', 'aria-label': 'مبلغ الشحن', style: 'width:90px;height:44px;border:1px solid var(--line);border-radius:12px;padding:0 10px;background:var(--surface)' }),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { const v = parseFloat(document.getElementById(tid).value); if (v > 0) act('admin_topup', { p_youth: y.id, p_amount: v }, 'تم الشحن'); } }, 'شحن')] : null));
  }) : h('div', { class: 'empty' }, h('b', null, 'لا يوجد شباب مسجلون'), h('span', null, 'سيظهرون هنا عندما يسجلون من التطبيق.')));
}
function adminSettings() {
  const c = S.settings;
  return h('div', { class: 'card' }, h('h3', null, 'الأسعار والعمولة'),
    field('s-pct', 'عمولة التطبيق من أجرة الشاب (%)', { type: 'number', value: c.commission_pct, mode: 'decimal' }),
    field('s-price', 'ثمن القنينة (درهم)', { type: 'number', value: c.bottle_price, mode: 'decimal' }),
    field('s-min', 'أقل أجرة للشاب (درهم)', { type: 'number', value: c.min_fee, mode: 'decimal' }),
    h('div', { class: 'err', id: 'err', role: 'alert' }),
    h('button', { class: 'btn', type: 'button', disabled: S.busy, onclick: async () => {
      const p = parseFloat(val('s-pct')), pr = parseFloat(val('s-price')), mn = parseFloat(val('s-min'));
      if (!(p >= 0 && p <= 50 && pr > 0 && mn >= 0)) return setErr('تأكد من القيم (العمولة بين 0 و50).');
      await act('admin_update_settings', { p_pct: p, p_price: pr, p_min: mn }, 'تم حفظ الإعدادات');
    } }, 'حفظ'), h('p', { class: 'muted' }, 'التغيير يسري على الطلبات الجديدة فقط.'));
}
function exportCsv() {
  const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const head = ['التاريخ', 'الزبون', 'الحي', 'الطابق', 'الحالة', 'الشاب', 'ثمن القنينة', 'أجرة الشاب', 'العمولة'];
  const rows = S.orders.slice().sort(byNew).map(o => [o.created_at, o.customer_name, o.hood, o.floor, ST[o.status], o.youth_name, o.bottle_price, o.fee, o.commission]);
  const blob = new Blob(['﻿' + [head, ...rows].map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'orders.csv'; document.body.append(a); a.click(); a.remove();
}

/* ---------- البيانات ---------- */
async function loadAll() {
  if (!S.session || !S.profile) return;
  const role = S.profile.role;
  const jobs = [
    sb.from('profiles').select('*').eq('id', uid()).maybeSingle(),
    sb.from('settings').select('*').eq('id', 1).maybeSingle(),
    sb.from('orders').select('*').order('created_at', { ascending: false }).limit(300),
    sb.from('order_contacts').select('*').limit(300)
  ];
  if (role === 'youth') jobs.push(sb.from('wallet_tx').select('*').order('created_at', { ascending: false }).limit(8));
  if (role === 'admin') { jobs.push(sb.from('profiles').select('*').eq('role', 'youth').limit(500)); jobs.push(sb.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'customer')); }
  const res = await Promise.all(jobs);
  if (res[0].data) S.profile = res[0].data;
  if (res[1].data) S.settings = { ...DEF, ...res[1].data };
  if (res[2].data) S.orders = res[2].data;
  if (res[3].data) { S.contacts = {}; res[3].data.forEach(c => { S.contacts[c.order_id] = c; }); }
  if (role === 'youth' && res[4] && res[4].data) S.tx = res[4].data;
  if (role === 'admin') { if (res[4] && res[4].data) S.youths = res[4].data; if (res[5] && typeof res[5].count === 'number') S.customersCount = res[5].count; }
}
async function afterLogin(force) {
  if (!S.session) return;
  if (!force && S.loadedFor === uid()) return;
  S.loadedFor = uid();
  const { data } = await sb.from('profiles').select('*').eq('id', uid()).maybeSingle();
  S.profile = data || null;
  if (S.profile) { await loadAll(); subscribe(); }
}
function subscribe() {
  if (S.channel) return;
  const ch = sb.channel('alo-live');
  ['orders', 'order_contacts', 'profiles'].forEach(t => ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, onChange));
  ch.subscribe(); S.channel = ch;
}
let lastStatuses = {};
async function onChange() {
  const prev = lastStatuses;
  await loadAll().catch(() => {});
  if (S.profile && S.profile.role === 'customer') {
    S.orders.forEach(o => { const p = prev[o.id]; if (p && p !== o.status && o.customer_id === uid()) {
      if (o.status === 'accepted') toast('قبل شاب طلبك'); else if (o.status === 'picked') toast('القنينة الممتلئة مع الشاب'); else if (o.status === 'delivered') toast('وصلت بوطتك'); } });
  }
  lastStatuses = Object.fromEntries(S.orders.map(o => [o.id, o.status]));
  sched();
}

/* ---------- الإقلاع ---------- */
async function boot() {
  render();
  if (!sb) return;
  try {
    const { data } = await sb.auth.getSession(); S.session = data.session;
    sb.auth.onAuthStateChange(async (ev, sess) => {
      S.session = sess;
      if (!sess) { S.profile = null; S.loadedFor = null; render(); return; }
      await afterLogin(); S.ready = true; render();
    });
    if (S.session) await afterLogin();
  } catch (e) { /* يعرض شاشة الدخول */ }
  S.ready = true; render();
  lastStatuses = Object.fromEntries(S.orders.map(o => [o.id, o.status]));
  setInterval(() => { if (document.visibilityState === 'visible' && S.profile) onChange(); }, 20000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
})();
