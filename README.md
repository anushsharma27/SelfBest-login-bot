# ClockBot — WhatsApp Auto Clock-In/Out

Automate daily clock-in and clock-out WhatsApp messages using Baileys (WhatsApp WebSocket API) + Turso (SQLite cloud DB).

---

## 🚀 Quick Start (Local)

### 1. Create a Turso Database
- Go to [turso.tech](https://turso.tech) → create a free account
- Create a new database
- Copy the **Database URL** (starts with `libsql://`) and **Auth Token**

### 2. Set up environment variables
```bash
cp backend/.env.example backend/.env
```
Edit `backend/.env` and fill in all values:
```
TURSO_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-token-here
JWT_SECRET=any-random-secret-string
ADMIN_EMAIL=admin@youremail.com
ADMIN_PASSWORD=yourpassword
PORT=3000
APP_TIMEZONE=Asia/Kolkata
```

### 3. Install and run
```bash
cd backend
npm install
node index.js
```

### 4. Open the app
Visit `http://localhost:3000` — log in with your `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

---

## 👥 Adding Team Members
1. Log in as Admin → go to **Admin Panel**
2. Click **Add Member** — enter name, email, password
3. Share the app URL and their credentials with each team member

---

## ⚙️ Each User Setup
1. Log in to the app
2. Go to **My Schedule**
   - Enter the company bot's WhatsApp number (e.g. `919876543210`)
   - Set your shift start time (clock-out auto-calculates at +9h)
   - Choose your working days → Save
3. Go to **Dashboard** → click **Connect WhatsApp** → scan the QR code with your WhatsApp
4. Done! ClockBot will send messages automatically every day

---

## ☁️ Deploy to Render

1. Push code to GitHub
2. Go to [render.com](https://render.com) → New Web Service → connect your repo
3. Set **Root Directory** to `backend`
4. Add all environment variables from `.env` in Render, including `APP_TIMEZONE=Asia/Kolkata`
5. Deploy!

WhatsApp session auth is stored in Turso, so the Render free tier does not need a persistent disk.

### Keep it alive (free tier)
Set up [UptimeRobot](https://uptimerobot.com) to ping:
```
https://yourapp.onrender.com/api/health
```
Every **5 minutes** — this prevents the free tier from sleeping.

### Share with team
Give team members your Render URL — they log in, set schedule, scan QR. Done.

---

## 🏗️ Project Structure

```
self-best-bot/
├── backend/
│   ├── index.js          # Express server entry point
│   ├── db.js             # Turso DB connection + init
│   ├── whatsapp.js       # Multi-user Baileys session manager + DB auth store
│   ├── scheduler.js      # Cron job + durable company-bot workflow state
│   ├── middleware/
│   │   └── auth.js       # JWT auth middleware
│   ├── routes/
│   │   ├── auth.js       # Login, me, change-password
│   │   ├── whatsapp.js   # QR, status, disconnect, reconnect
│   │   ├── schedule.js   # Schedule CRUD + pause today
│   │   ├── logs.js       # User activity logs
│   │   └── admin.js      # Admin: manage users + all logs
│   └── render.yaml       # Render deployment config
└── frontend/
    ├── index.html        # App shell + Tailwind + FontAwesome
    ├── core.js           # Config, API helpers, auth, layout
    ├── dashboard.js      # WA status, QR, schedule summary, pause
    ├── schedule.js       # Schedule form + save
    ├── logs.js           # Logs table
    ├── admin.js          # Admin panel
    └── init.js           # App entry point
```

---

## 🔒 Security
See [SECURITY.md](./SECURITY.md) for a plain-English explanation of how this app works and what data it stores.
