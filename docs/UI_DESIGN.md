# Slotly UI Design Handoff

**Status:** Revised Figma pass prepared for user review; not approved yet.  
**Figma file:** [Slotly](https://www.figma.com/design/KXLdrss45iv96QmeJLYnbX/Slotly)  
**Companion guide:** `AGENTS.md`  
**Phase mapping:** Phase 2 is UI/UX design and approval. Phase 3 is database/backend foundation. Frontend implementation follows in Phases 4–9; read this document before those UI tasks.

The Figma frames are design references, not working application screens. Names, emails, dates, references, passwords placeholders, KPI totals and chart values are illustrative. Never copy sample metrics or credentials into production code.

## 1. Figma page inventory

### Customer Booking
[Open Customer Booking](https://www.figma.com/design/KXLdrss45iv96QmeJLYnbX/Slotly?node-id=0-1)

| Frame | Node ID | Purpose |
|---|---:|---|
| 0 - Public landing page | `18:153` | Public business introduction and booking entry point |
| 1 - Select service | `4:18` | Active services, durations and descriptions |
| 2 - Date and time | `5:45` | Calendar, available slots and booking summary |
| 3 - Your details | `5:226` | Guest or registered customer details and request submission |
| 4 - Request received | `15:145` | Pending state, appointment summary and private cancellation link |
| Mobile - Select service | `15:190` | 390px customer service-selection layout |
| 5 - Sign in and register | `18:198` | Email/password sign-in and customer registration |
| 6 - My appointments | `18:241` | Customer upcoming/past bookings; pending-only cancellation action |
| 7 - No availability state | `18:277` | Empty availability and alternate-date choices |
| 8 - Guest cancellation / Confirm | `40:451` | Private-link review and explicit cancellation confirmation |
| 9 - Guest cancellation / Success | `40:496` | Cancellation success and link invalidation state |
| 10 - Guest cancellation / Expired link | `40:529` | Generic unavailable-link response without revealing booking existence |
| 12 - Booking details and pending cancellation | `40:551` | Registered customer's booking detail and cancel-confirmation dialog |

The Customer Booking page also retains a small set of earlier staff/admin explorations. They are preserved for reference; use the newer **Staff & Admin** page below as the canonical implementation direction when a duplicate exists.

| Earlier reference frame | Node ID | Relationship to canonical frame |
|---|---:|---|
| Staff / Booking requests | `34:319` | Earlier staff queue exploration; use `16:153` and `20:188` as current staff queue/dashboard references |
| Staff / My schedule | `35:254` | Earlier staff schedule exploration; use `16:244` for the current availability editor |
| Admin / Dashboard | `37:296` | Earlier admin dashboard; use `16:342` for the current overview |
| Admin / Services | `37:438` | Earlier service catalogue; use `20:324` for current service management |
| Admin / Staff | `37:529` | Earlier staff list; use `20:420` for current staff management |

### Staff & Admin
[Open Staff & Admin](https://www.figma.com/design/KXLdrss45iv96QmeJLYnbX/Slotly?node-id=11-145)

| Frame | Node ID | Purpose |
|---|---:|---|
| 1 - Staff / Appointment queue | `16:153` | Assigned requests, filters and pending/confirmed states |
| 2 - Staff / Availability | `16:244` | Weekly hours and one-off time off |
| 3 - Admin / Overview | `16:342` | Business-wide KPI summary and activity charts |
| 4 - Admin / Business settings | `16:455` | Business profile, booking window, email and cancellation settings |
| 5 - Admin / Reports | `16:529` | Date/service/staff/status filters, charts and CSV export |
| 6 - Staff / Dashboard | `20:188` | Staff queue and today's own schedule |
| 7 - Staff / Appointment detail and review | `20:260` | Pending request with conflict-blocked approval; staff cannot reassign |
| 8 - Admin / Service management | `20:324` | Active/inactive service catalogue and durations |
| 9 - Admin / Staff management | `20:420` | Staff roster, roles and active state |
| 10 - Admin / Appointment management | `20:509` | Business-wide booking search and filters |
| 11 - Staff / Approval confirmation | `22:191` | Successful availability check and approval confirmation |
| 12 - Staff / Reject request confirmation | `42:488` | Reject assigned pending request and queue booking-update email |
| 13 - Staff / Reschedule assigned appointment | `42:530` | Staff changes time but keeps the same assigned staff member |
| 14 - Admin / Reassign and reschedule | `44:488` | Admin-only change of assigned staff with fresh availability check |
| 15 - Admin / Staff temporary password | `44:549` | One-time generated staff credential, expiry and forced first-login change |
| 16 - Admin / Resolve schedule impact | `44:602` | Block a schedule change until affected future bookings are resolved |
| 17 - Staff / First sign-in password change | `49:488` | Force the staff member to replace an Admin-issued temporary password; show generic expired-credential guidance |
| Mobile - Staff dashboard | `45:488` | 390px responsive staff queue/dashboard treatment |
| Mobile - Admin overview | `45:520` | 390px responsive admin overview and shortcuts |

### UI States and Design Tokens
[Open UI States](https://www.figma.com/design/KXLdrss45iv96QmeJLYnbX/Slotly?node-id=23-185)

- `23:186` — loading, field validation, submission error, empty queue, approval conflict and request-received states.
- `46:483` — complete visual-token board, including base/status/error/warning/focus/disabled colors, type samples, spacing, radii, shadow and operational warning samples.

## 2. Visual system and tokens

Continue the existing Slotly system. Do not replace it with a generic AI-generated dashboard style.

### Color tokens

| Token | Hex | Use |
|---|---|---|
| `color.canvas` | `#F5F4F0` | Warm ivory app background |
| `color.surface` | `#FFFFFF` | Cards, tables, forms and dialogs |
| `color.navy` | `#14213D` | Primary actions, selected navigation and key emphasis |
| `color.text` | `#1B2333` | Main headings and text |
| `color.text-secondary` | `#454B57` | Body text |
| `color.text-muted` | `#6F6B63` | Secondary labels and helper text |
| `color.border` | `#D9D6CE` | Dividers, fields and card edges |
| `color.focus` | `#4769A6` | Keyboard focus ring |
| `status.pending.bg` | `#F2ECDD` | Pending badge background |
| `status.pending.text` | `#7D612E` | Pending badge text |
| `status.pending.border` | `#E3D8B9` | Pending outline |
| `status.confirmed.bg` | `#E6EFE6` | Confirmed/success background |
| `status.confirmed.text` | `#3F6247` | Confirmed/success text |
| `status.confirmed.border` | `#C8D9C9` | Confirmed outline |
| `status.rejected.bg` | `#F2E6E2` | Rejected background |
| `status.rejected.text` | `#8C4A40` | Rejected text |
| `status.rejected.border` | `#E0C9C1` | Rejected outline |
| `status.cancelled.bg` | `#EAECEF` | Cancelled background |
| `status.cancelled.text` | `#626771` | Cancelled text |
| `status.cancelled.border` | `#D8DBE0` | Cancelled outline |
| `color.error.bg` | `#F8ECEA` | Form/server error background |
| `color.error.text` | `#8C3F3A` | Error message and invalid field text |
| `color.error.border` | `#C9786D` | Invalid field/error border |
| `color.warning.bg` | `#F6F0E2` | Schedule/service impact warning |
| `color.warning.text` | `#765E2C` | Warning text |
| `color.warning.border` | `#E6D9B8` | Warning border |
| `color.disabled.bg` | `#E3E3E3` | Disabled controls |
| `color.disabled.text` | `#777777` | Disabled control text |
| `color.disabled.border` | `#E0E0E0` | Disabled outline |

Status must always include a readable text label; never communicate state through color alone. Keep status background, text and border as a matched set. Re-check WCAG contrast for actual foreground/background combinations during frontend implementation.

### Typography

| Role | Typeface | Use |
|---|---|---|
| Display | Source Serif 4, SemiBold | Slotly wordmark, page and section headings |
| Interface | IBM Plex Sans, Regular / Medium / SemiBold | Navigation, labels, body, buttons, tables and helper text |
| Numeric | IBM Plex Mono, Regular / Medium | Dates, times, durations, references and numeric data |

Suggested sizes: page heading 34–36px; card/section heading 18–20px; body 13–15px; helper/metadata 11–12px. **11px is the minimum text size for UI metadata.** Do not shrink labels to 9–10px to fit a table; allow wrapping, reflow or scrolling instead.

### Spacing, radii and shadow

- Spacing scale: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64px`.
- Radius tokens: `0, 3, 4, 8px`; use full-pill radius only for compact status tags where needed.
- Default shadow: none. Optional card shadow: `0 1px 2px rgba(27, 35, 51, 0.06)` only when a subtle separation is needed.
- Focus: visible 2px focus ring using `color.focus`, with clear offset from the component edge. Do not remove the browser focus indicator without an equivalent.
- Disabled: use the disabled background/text/border tokens; disabled controls must not look actionable and must retain legible text.

### Layout and surfaces

- Desktop reference frames: 1440 × 900; mobile reference frames: 390px wide.
- Desktop staff/admin sidebar: 246px wide; content begins around x=292px.
- Use aligned card edges, consistent spacing, warm-gray borders and white surfaces on ivory canvas.
- Avoid gradients, glassmorphism, excessive shadows, oversized pill controls and decorative dashboard filler.

## 3. Reusable Figma components

The `Slotly Components` frame on Customer Booking contains the first local components:

| Component | Node ID |
|---|---:|
| Site Header | `3:11` |
| Button / Primary | `3:14` |
| Button / Secondary | `3:17` |
| Field / Text | `3:23` |
| Field / Multiline | `3:29` |
| Service Row | `3:36` |
| Time Slot | `3:40` |
| Time Slot / Selected | `3:44` |
| Day Cell | `3:47` |
| Step / Complete | `4:7` |
| Step / Active | `4:12` |
| Step / Upcoming | `4:17` |

In React, formalize reusable buttons, fields, status tags, dialogs, cards, tables, page headers, navigation and feedback states rather than copying styling on each route.

## 4. Role, navigation and permission behavior

### Customer / Guest

- Both registered customers and guests may book. Customer accounts use email/password only.
- Customer chooses service/date/time, never staff.
- Registered customers see only their own appointments and can cancel only their own pending booking.
- Guest receives a private cancellation link after request submission and in the request-received email. It authorizes only that pending request.
- Guest cancellation is a read-only GET review screen followed by a clear confirmation POST. Show a success state after cancellation and a generic unavailable-link state for invalid, used, expired or already-updated links; do not reveal whether a booking exists.
- A confirmed booking is not self-cancellable in the MVP; direct the customer to contact the business.

### Staff

- Staff see their own dashboard, assigned queue, booking detail and availability editor.
- Staff can approve/reject assigned pending requests and reschedule/edit an appointment while keeping it assigned to themselves.
- **Staff cannot reassign an appointment to another staff member.** The conflict screen offers another time, decline, or an Admin route for reassignment—not a staff-side reassignment action.
- Staff may update their own working hours/time off only when no future booking is made invalid. Otherwise block the change and require Admin to resolve affected appointments first.
- Every active staff member can perform every active service; do not create per-staff service assignment UI.

### Admin

- Admin manages all appointments, services, staff, business settings and reports.
- Only Admin can change an appointment's assigned staff member, deactivate staff, resolve schedule impacts, deactivate services, or reset a staff password.
- Service deactivation and schedule/staff changes must warn about future affected pending/confirmed bookings and block save until they are explicitly resolved. Never silently change a customer's selected service.
- Admin creates staff accounts. Temporary password is generated server-side, displayed once, shared out of band, expires after 24 hours, and forces a password change before staff workspace access. Forgotten staff password is reset by Admin using the same flow.

## 5. Booking lifecycle and critical behavior

Only these booking statuses exist in the MVP: `pending`, `confirmed`, `rejected`, `cancelled`. Do not add an `expired` status.

1. Customer submits a request; it enters `pending`.
2. Pending requests never reserve/block availability. Multiple pending requests can target the same slot.
3. Confirmed appointments block overlapping time for the assigned staff member. Rejected/cancelled bookings do not block.
4. Server rejects newly submitted start times that are not strictly in the future. Approval also fails if a pending request's start time has passed. Stale pending requests stay `pending` until staff/Admin reject or cancel them; the UI must show they cannot be approved.
5. Immediately before approval, the backend rechecks working hours, time off and confirmed appointment overlaps. A conflict keeps approval blocked. The server must be concurrency-safe; client-side disabled state is not security.
6. Staff can resolve a conflict by choosing another time within their own schedule or declining. Only Admin can reassign to another staff member.
7. When Admin changes hours/time off/deactivates staff, show impacted future bookings and block the change until they are reassigned, rescheduled, rejected or cancelled as appropriate. Service deactivation is blocked while future pending/confirmed appointments use that service.
8. Email types: `request_received`, `booking_confirmed`, `booking_update`. The third type covers rejection, staff/Admin cancellation and material Admin appointment changes. No appointment reminders exist.

## 6. Data/content rules

- All names, emails, appointment references, dates, KPIs and chart values in Figma are illustrative.
- Never seed production data or hard-code screenshot values into React.
- Use truthful empty states when there is no database data.
- Admin charts and reports use server-side D1 aggregates with their active filters.
- Display business-local dates/times using the configured IANA timezone.
- Never show customer a staff selector or disclose staff availability beyond the slots offered.

## 7. Responsive behavior

Existing references include customer mobile service selection (`15:190`), staff mobile dashboard (`45:488`) and admin mobile overview (`45:520`). Use these as starting points, not as proof that the whole product is responsive.

- On narrow screens, stack cards and forms; keep important booking actions visible.
- Convert dense tables to readable card/list rows or a deliberate horizontally scrollable area with affordance.
- Keep status labels, duration/time values and action controls legible; do not reduce metadata below 11px.
- Staff and Admin still need responsive equivalents for appointment detail, review/approval, availability, service/staff management and report filtering before responsive design can be called complete.

## 8. Required UI states

The UI States page includes loading, validation, submission error, empty queue, approval conflict and request-received references. Additional frames added in this pass cover guest cancellation confirmation/success/unavailable link, customer pending booking cancellation, staff rejection, staff rescheduling, admin reassignment, temporary staff password, and schedule/service impact warnings.

Implementation must also include:
- Past pending request that cannot be approved (without inventing `expired` status).
- Approval conflict and success confirmation.
- Guest link invalid/expired/used generic state.
- Schedule/time-off edit blocked by impacted bookings.
- Service deactivation blocked by future bookings.
- Staff first-login forced password change and invalid/expired temporary credential.
- Email delivery failure that does not reverse a committed booking state change.

## 9. Phase 2 review checklist

- [ ] Approve visual direction, typography and complete token set.
- [ ] Approve customer/guest booking and pending-only cancellation behavior.
- [ ] Approve three transactional email types and no-reminder rule.
- [ ] Approve staff vs Admin permissions, including Admin-only reassignment.
- [ ] Approve temporary staff password setup/reset behavior.
- [ ] Approve schedule/service impact blocking behavior.
- [ ] Review mobile references and agree that remaining responsive states are required during implementation.

**Current state:** The Figma file contains the expanded design references and token board. This is still a static design pass, not a working prototype. The design awaits user approval. Phase 3 is D1/database and backend foundation; frontend implementation follows in Phases 4–9.
