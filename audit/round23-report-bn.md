# রাউন্ড ২৩ — টিয়ার ২ + ৩, নতুন চার্ট-স্টাইল, UI পলিশ

তারিখ: ২০২৬-১০-২৩ · বেস: `a3e4fd7` (origin/main)

---

## ১. নতুন চার্ট-স্টাইল (Tier-3 #11) — ১৪ → ১৯

TradingView-এর পাঁচটি বার-সংখ্যা-বদলানো স্টাইল, সবগুলোই দুই ব্যাকএন্ডে (Canvas2D + WebGL2):

| স্টাইল | নিয়ম (গবেষণা-ভিত্তিক) | সেটিংস |
|---|---|---|
| **Renko** | একই দিকে এক বক্স, বিপরীতে **দুই** বক্স (একটি মুছে + একটি ছাপা); সাব-থ্রেশহোল্ড বিচ্যুতি = wick | box method (ATR/Traditional), ATR length, multiplier, source (Close/OHLC), wicks |
| **Range** | প্রতিটি বার ঠিক এক range উঁচু, ক্লোজ চরমে | method (ATR/Traditional), range, ATR length/factor, source |
| **Kagi** | শুধু reversal-এ মোড়; yang = মোটা (আগের চরম ভাঙে), yin = সরু | method, reversal %, ATR, source |
| **Point & figure** | X/O কলাম, **৩ বক্স** বিপরীতে গেলেই নতুন কলাম | box method, box size, ATR, reversal (boxes), source |
| **Line break** | শেষ **N** লাইনের high/low ভাঙলেই একটি লাইন | line count |

**সিম (নতুন):** `rebucket` — `Raw → M` বার, `BarTransform`-এর ১:১ চুক্তি এদের জন্য অচল।
`EngineOrchestrator.deriveView()` এক জায়গায় দুই ধাপ (rebucket → transform); লাইভ টিকে
পূর্ণ রি-বিল্ড (ব্রিক সংখ্যায় কম, তাই সস্তা); স্টাইল বদলালে `setBars(..., { resetView: true })`
কারণ পুরনো px-per-bar নতুন সিরিজে অর্থহীন (এটাই "সব কিছু ডান কোণে চেপে যাওয়া" বাগটির কারণ ছিল)।

**পেইন্ট হিন্ট:** সিন্থেটিক বারে `OHLCV.styleHint { yang?, box?, mark? }` — Kagi-র রেখার
ওজন, P&F-এর বক্স ও গ্লিফ। প্রকৃত ডেটায় কখনো থাকে না, সংরক্ষণ হয় না।

---

## ২. টিয়ার ২

| # | আইটেম | অবস্থা | প্রমাণ |
|---|---|---|---|
| 7 | High-low, HLC bars, volume candles | ✅ রাউন্ড ২২-এ সম্পন্ন | `paint-variants` ১৭/১৭ |
| 8 | **Per-layout share link** | ✅ নতুন | `test/share-link.test.ts` (১২) |
| 9 | **Pattern breadth** | ✅ নতুন | `test/drawings-patterns-t2.test.ts` (৩৮) |
| 10 | Global drawings sync (3-state) | ✅ আগেই ছিল — যাচাই | `workspace-multichart-ux` |

**#8 — লেআউট শেয়ার লিংক:** নতুন কোডেক নয়। একই `WorkspaceState`, একই gzip+base64url কোডেক,
শুধু প্রিফিক্স `#l1=` / `#l0=` (ওয়ার্কস্পেস লিংক `#s1=`/`#s0=`)। ফলে —
* রিসিপিয়েন্ট ডিকোড করার **আগেই** বুঝে নিতে পারে এটি একটি লেআউট;
* লেআউটটি **সেভড লেআউট হিসেবে** ইনবক্স হয় (`… (shared)` নামে, নাম সংঘর্ষে `(2)`), তারপর খোলে —
  কেউ তার চলমান ওয়ার্কস্পেস হারায় না;
* সব ভ্যালিডেশন ফাইলের মতোই একই স্যানিটাইজার দিয়ে।
UI: লেআউট পিকারের প্রতিটি সেভড সারিতে একটি `link` বাটন (কপি হলে বাটনেই "copied" দেখায়)।

**#9 — প্যাটার্ন:** TradingView-এর তালিকা অনুযায়ী পাঁচটি টুল —
* **Triangle Pattern** (A·B·C·D·E, দুই অভিসারী ট্রেন্ডলাইন),
* **Three Drives** (1·A·2·C·3 — ড্রাইভের প্রান্ত ১/২/৩, রিট্রেসমেন্টের প্রান্ত A/C; লেগ-রেশিও দেখায়),
* **Elliott Triangle (ABCDE)**,
* **Elliott Double Combo (WXY)**,
* **Elliott Triple Combo (WXYXZ)** (দুটি X শেয়ার করা লেবেল — TV-র নিজস্ব রীতি)।

**#10 — ড্রয়িং স্কোপ:** ইতিমধ্যেই ৩-অবস্থা: লিংক **বন্ধ** / **layout** / **global**
(`drawingsBySymbol` + পিকারের Drawings সারির `layout ⇄ global` চিপ)। নতুন করে বানানো হয়নি —
ভেরিফাই করা হয়েছে যেন ডুপ্লিকেট সিস্টেম না ওঠে।

---

## ৩. টিয়ার ৩

| # | আইটেম | অবস্থা |
|---|---|---|
| 11 | Renko/Kagi/P&F/Line break/Range | ✅ **সম্পূর্ণ** (৫/৫) |
| 12 | **Bar-data reference model** | ✅ নতুন — `src/core/model/bar-ref.ts` |
| 13 | **Volume-at-price feed** | ✅ নতুন — `src/core/volume-profile/feed.ts` |
| 14 | **Image / Table** | ✅ প্রি-রিকুইজিট দুটোই — অ্যাসেট স্টোর + টেক্সট লেআউট |

**#12 `BarRef`:** `{ time, index? }` — time কর্তৃত্বপূর্ণ, index শুধু হিন্ট। ব্যাকফিলে হাজার
বার prepend হলেও রেফারেন্স টেকে (পরীক্ষায় ৩ → ১০৩), আর অদৃশ্য বার হলে `-1` (ভুল বার কখনো নয়)।

**#13 VP ফিড:** `buildVolumeProfile(bars)` (OHLC থেকে ইউনিফর্ম ডিস্ট্রিবিউশন — ডকুমেন্টেড
অনুমান) ও `buildTradeProfile(trades)` (নিখুঁত পথ), সাথে POC / VAH / VAL (POC থেকে বড়
প্রতিবেশী নিয়ে ৭০% পর্যন্ত বৃদ্ধি), ডেল্টা ও `bucketAt`। রেন্ডারিং এখন শুধু ভোক্তা।

**#14 প্রি-রিকুইজিট:**
* `AssetStore` — content-addressed (একই ছবি একবার), per-asset ২ MB, per-document ৮ MB,
  ৪০৯৬ px এজ ক্যাপ, `image/*` ছাড়া কিছু নয়, `toJSON/fromJSON` (পড়ার সময়ও একই ক্যাপ)।
* `measureTable()` — ফন্ট-মুক্ত টেক্সট লেআউট: শব্দ-ভিত্তিক wrap (অতি-লম্বা শব্দ ভেঙে),
  কলাম-প্রস্থ, সারির উচ্চতা, অফসেট; নির্ধারক ও ব্যাকএন্ড-নিরপেক্ষ।

---

## ৪. UI (সরাসরি অনুরোধ)

* **মিনিমাল লেআউট আইকন** — ফ্রেম এখন ১.০৫px হেয়ারলাইন ও ৪৫% ইঙ্কে, **সিম** পূর্ণ ইঙ্কে;
  বাটনের বর্ডার/পিল বাদ, হোভারে শুধু ওয়াশ, নির্বাচিত লেআউটে একলাইন রিং। (`audit/r23-layout-icons.png`)
* **স্মুথ স্ক্রলিং** — `src/ui/scrolling.ts`: এক ডজন স্ক্রল-সারফেসের এক রেসিপি —
  `overscroll-behavior: contain` (পেছনের পেজ স্ক্রল হয় না), মোমেন্টাম, থাম্ব-অনলি ৮px
  স্ক্রলবার, `scroll-padding-block`; `scroll-behavior: smooth` শুধু পয়েন্টার-চালিত সারফেসে
  (মেনুতে নয় — তীর-কি নেভিগেশন ল্যাগ করত), `prefers-reduced-motion` মানে অটো।

---

## ৫. টেস্ট ও যাচাই

| ফাইল | ফল |
|---|---|
| `test/rebucket.test.ts` | **২৬/২৬** |
| `test/share-link.test.ts` (পুরনো ৬ + নতুন ৬) | **১২/১২** |
| `test/drawings-patterns-t2.test.ts` | **৩৮/৩৮** |
| `test/bar-ref.test.ts` | **৯/৯** |
| `test/volume-profile-feed.test.ts` | **৯/৯** |
| `test/asset-store-table.test.ts` | **১৫/১৫** |
| `test/chart-type-registry.test.ts` | **১৬/১৬** |
| `test/drawings-controller.test.ts` (গ্রুপিং) | ৩/৩ (দুটি পুরনো প্রত্যাশা ঠিক করা হয়েছে: `gannsquarefixed`, `pin`) |

`npm run typecheck` → ০ এরর · `npx eslint src` → ০ এরর

**লাইভ প্রিভিউ (পোর্ট ৫১৯০):** পাঁচটি স্টাইল সুইচ করে স্ক্রিনশট —
`audit/r23-style-{renko,range,kagi,point-figure,line-break}.png`, শিট `audit/r23-styles-sheet.png`;
লেআউট পিকার `audit/r23-layout-icons.png` (৪৭ প্রিসেট, `scroll-behavior: smooth` নিশ্চিত)।

---

## ৬. সৎ সীমাবদ্ধতা

1. **Image / Table** — স্টোর ও মেজার সম্পূর্ণ ও টেস্টেড, কিন্তু **ড্রয়িং টুল হিসেবে পেইন্ট**
   এখনো হয়নি (ড্রয়িং লেয়ার টেক্সট-রান আঁকে না)। এটাই পরের ধাপের কাজ।
2. **VP ফিড** — ডেটা/গণিত প্রস্তুত; ফুটপ্রিন্ট/SVP/TPO **রেন্ডারার** এখনো লেখা হয়নি।
3. **Bar-data reference model** — `BarRef` চালু, কিন্তু বিদ্যমান ড্রয়িং/নোটগুলো এখনো ইনডেক্স
   রাখে; মাইগ্রেশন ধাপে ধাপে।
4. **Kagi-র ডিফল্ট** ATR (TV-র ডিফল্ট ৪%) — ক্রিপ্টোর ৮০k→৮০k পরিসরে ৪% অর্থহীন, তাই
   ATR ডিফল্ট; Traditional এখনো সেটিংসে আছে।
5. **P&F-এর বক্স** প্রতি কলামের শুরুতে নির্ধারিত (ATR চলমান হলে ট্রেডিংভিউয়ের মতোই গ্রিড
   স্থিতিশীল রাখতে)।
6. `npm run test:browser:ci` এই স্যান্ডবক্সে মেমরি-সীমিত কারণে ক্র্যাশ করে — বেস `a3e4fd7`-এও
   একই, তাই রিগ্রেশন নয় (রাউন্ড ২২-এ প্রমাণিত)।

---

## ৭. ফাইল-তালিকা

**নতুন:** `src/core/price-styles/rebucket.ts` · `src/core/model/bar-ref.ts` ·
`src/core/volume-profile/feed.ts` · `src/core/assets/store.ts` · `src/core/model/table.ts` ·
`src/workspace/share-link.ts` · `src/ui/scrolling.ts` ·
`src/core/drawings/types/{ElliottTriangle,ElliottDoubleCombo,ElliottTripleCombo,TrianglePattern,ThreeDrives}.ts` ·
৫টি নতুন টেস্ট ফাইল।

**সম্পাদিত (মূল):** `src/chart-types/{builtins,registry}.ts` ·
`src/core/engine/EngineOrchestrator.ts` · `src/renderers/native/backend/{Canvas2dBackend,WebGL2Backend}.ts` ·
`src/core/price-styles/variants.ts` · `src/core/model/ohlcv.ts` · `src/widget/{layout-picker,topbar,drawings-drawer,more-drawer}.ts` ·
`src/workspace/{VelaWorkspace,layouts}.ts` · `src/core/drawings/{registry,toolbar,Drawing,index}.ts`.
