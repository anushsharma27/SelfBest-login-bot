# Security & Privacy — ClockBot 🤖

This document explains in plain English exactly what this app does, what data it touches, and what it doesn't.

---

## What is Baileys?

Baileys is an open-source library that connects to WhatsApp using the same protocol as **WhatsApp Web** (the browser version). When you scan the QR code:

- Your phone **links** ClockBot as a secondary device — exactly like scanning a QR code on web.whatsapp.com
- Your phone stays as the primary — ClockBot is just a linked device
- You can unlink it anytime from your phone → Settings → Linked Devices

---

## What does this app actually do?

ClockBot sends **exactly 2 messages per day** per user:
1. A clock-in message (e.g. `in`) at your scheduled time
2. A clock-out message (e.g. `out`) at your scheduled time + 9 hours

Both messages go to a single destination: the company bot's WhatsApp number you configure.

---

## What does this app NOT do?

- ❌ Does **not** read any of your WhatsApp messages or chats
- ❌ Does **not** access your contacts list
- ❌ Does **not** download or view any media
- ❌ Does **not** send messages to anyone except the bot number you set
- ❌ Does **not** store your WhatsApp message history

---

## What data is stored?

Only three things are stored in the database:

| Data | Purpose |
|------|---------|
| Your name, email, password (hashed) | Login authentication |
| Your schedule settings | Knowing when to send messages |
| A log of sent messages | So you can verify messages were sent |

Your WhatsApp session credentials are stored **only on the server disk** inside `auth_info/{userId}/` — these are the same credentials WhatsApp Web uses to keep you logged in.

---

## Can I verify this?

Yes — the **entire codebase is open source**. Every line that interacts with WhatsApp is in `backend/whatsapp.js`. You can read exactly what it does before using it.

---

## How to disconnect

You can disconnect your WhatsApp session at any time:
- **From the app**: Dashboard → Disconnect button
- **From your phone**: WhatsApp → Settings → Linked Devices → find "ClockBot" → Tap it → Log Out

Either way, the session is instantly invalidated.

---

## Admin data access

Admins can:
- See your name and email
- See your schedule settings
- See your message send logs (time, type, status)
- Delete your account and all data

Admins **cannot** see your WhatsApp messages or session content.
