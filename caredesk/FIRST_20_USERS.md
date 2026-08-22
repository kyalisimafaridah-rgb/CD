# CareDesk — First 20 Users Playbook

**Goal:** 20 clinics that have **logged at least one real visit** (not empty signups).

**Timebox:** 14–21 days of focused outreach.

---

## Your daily scoreboard

| Metric | Target |
|--------|--------|
| Clinics spoken to (face / WhatsApp) | 10/day |
| Live demos (2–5 min on your phone) | 5/day |
| New registrations | 2–3/day |
| Clinics that logged a visit same week | track hard |
| Paying (MoMo request submitted) | bonus, not required for “20” |

**Definition of a “user” for this goal:** clinic account + ≥1 patient + ≥1 visit in CareDesk.

---

## Week plan

### Days 1–2 — Ready to sell
- [ ] App live on your domain (Render + Supabase)
- [ ] `pnpm db:push` done (onboarding + payment tables)
- [ ] Your **MTN MoMo number** written on flyer + WhatsApp status
- [ ] You can register a test clinic in <3 minutes
- [ ] WhatsApp Business (or clean personal) with CareDesk name + logo
- [ ] Print 30 flyers (text below) or PDF on phone to show

### Days 3–10 — Hunt (walk + WhatsApp)
- [ ] List 40 clinic names/areas (map + walk)
- [ ] Visit 8–12 clinics/day where possible
- [ ] Message 10 owners/day on WhatsApp
- [ ] Demo on **their** problem: “Where do patient balances get lost?”
- [ ] Offer: **I set you up now, free, 15 minutes**

### Days 11–16 — Activate
- [ ] Call/WhatsApp every signup who has **0 visits**
- [ ] Help them log first patient + first visit together
- [ ] Ask: “Who else runs a clinic like yours?”

### Days 17–21 — Lock 20
- [ ] Count only clinics with a visit logged
- [ ] Fill gaps with referrals from happy users
- [ ] Screenshot 2–3 success notes (with permission) for Status

---

## Who to talk to

**Yes**
- Private clinics, 1–5 clinicians
- Owner or manager available same day
- Paper books / Excel / “we just remember”
- Busy OPD, not only inpatient hospital

**No (for now)**
- Big hospitals / government tenders
- “Send a proposal to procurement”
- People who only want a website

---

## 2-minute demo script (say this)

1. “I built CareDesk for clinics like yours — patients, visits, bills in one place.”
2. Open your phone → register a **demo patient** → start a **visit** → show the **bill**.
3. “Reception and doctor can both use it. Free to start.”
4. “When you outgrow free, you pay MTN MoMo — use your **clinic name** as the reason.”
5. “I can open your account now. What’s the clinic name and your email?”

If they hesitate: “No payment today. If you don’t use it in a week, you lose nothing.”

---

## WhatsApp scripts

### First message (cold)
```
Good morning Doctor/Sir/Madam 🙏
I’m [Your name]. I help small clinics run patients, visits, and bills on the phone — without losing balances in the book.

It’s called CareDesk. Free to start. I can set you up in about 15 minutes.

Are you the right person for clinic records/billing, or should I talk to someone else?
```

### After they say yes
```
Great. Please register here: [YOUR_APP_URL/register]

Use your real clinic name (you’ll need it if you ever pay by MoMo).

When you’re in, tell me — I’ll help you add the first patient and visit on a call.
```

### Day-2 nudge (no visit yet)
```
Hi — checking in on CareDesk.
Have you logged a patient visit yet?
If you’re stuck, send me a voice note and I’ll guide you in 5 minutes.
```

### Ask for referral (after they use it)
```
Glad it’s helping.
Do you know one other clinic owner who still uses only paper?
If you intro me on WhatsApp, I’ll set them up free as well.
```

---

## Flyer text (one page)

**CareDesk**  
Clinic patients · visits · bills — on your phone  

✓ Find any patient fast  
✓ Visit + bill in one flow  
✓ Free to start · Pay later by MTN MoMo  

Start free: [YOUR_APP_URL/register]  
WhatsApp: [YOUR_NUMBER]  
MoMo (when upgrading): [YOUR_MOMO] — reason = your clinic name  

---

## Objection cheat sheet

| They say | You say |
|----------|---------|
| “We’re fine with paper” | “Until a balance dispute. CareDesk keeps the bill with the visit.” |
| “No time” | “15 minutes setup. First visit is the training.” |
| “Is it expensive?” | “Free plan exists. Clinic plan is UGX 90,000/month when you need it.” |
| “Our internet is bad” | “Use it when online; keep the flow simple — patient → visit → bill.” |
| “Send information” | Send link + this flyer text + offer a call today 5pm. |

---

## Tracking

Use `first-20-tracker.csv` (same folder). Update every evening.

Columns: clinic name, area, contact, WhatsApp, status, registered?, first visit?, notes, next action.

Statuses: `lead` → `demo` → `registered` → `activated` (has visit) → `paying`

---

## Rules that get you to 20

1. **Talk to humans daily** — product alone won’t recruit clinics.  
2. **Count activations, not signups.**  
3. **You do the first visit with them** — that creates the habit.  
4. **One referral ask per activated clinic.**  
5. **Don’t wait for perfect ads or MTN API.**

When you hit 20 activated clinics, then tighten pricing, notifications, and automation.
