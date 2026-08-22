# CareDesk — Known Gaps & Next Actions

## Post-launch (week 1–2)
- [ ] Set ENFORCE_TRIAL_EXPIRY=true in Railway once first paying customers are onboarded
- [ ] Configure SENTRY_DSN in Railway for production error monitoring
- [ ] Switch AT_USERNAME from "sandbox" to live Africa's Talking username
- [ ] Verify Lemonsqueezy webhook is pointing to <APP_URL>/api/webhooks/lemonsqueezy
- [x] Edit patient — client-side edit modal is implemented in Patients.tsx
- [ ] Patient detail view — dedicated page with full visit history (currently a modal, not a page)
- [ ] Patient photo upload — R2 storage is configured, upload UI not built

## Phase 2 (month 1)
- [x] Data export — CSV/Excel download exists for bills, debtors, SMS log, activity log, revenue report, clinics (admin), and patient list.
- [x] Drug expiry date tracking — expiryDate field exists on drugs, with expired/expiring-soon checks in DrugInventory.tsx and a dispensing block in visit.create
- [ ] Insurance claim form generation
- [ ] Prescription history view per patient
- [ ] Responsive design audit — test on Android low-end devices common in East Africa
- [ ] Performance test with 5,000+ patients and 10,000+ visits

## Phase 3 (future)
- [ ] Multi-replica deployment — swap in-memory password-reset rate limiter for Redis
- [ ] MTN Mobile Money webhook integration (payment confirmation flow)
- [ ] Activity audit log export
- [ ] Patient communication history log
