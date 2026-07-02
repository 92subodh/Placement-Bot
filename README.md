# Telegram Placement Notification Bot

A robust, production-ready Telegram bot that monitors the AIT placement portal for new opportunities and notifications, sending instant updates to subscribed users.

## Features

- **Automated Polling:** Checks for new posts every 2 minutes.
- **Advanced Filtering:** Users can subscribe to specific keywords (e.g., "Amazon", "Internship") to only receive relevant updates.
- **Rich Notifications:** Converts HTML content to clean Telegram markdown.
- **Attachment Support:** Automatically downloads attachments (PDFs, Excel, etc.) from AWS S3 pre-signed URLs and sends them via Telegram.
- **Multi-user Support:** Multiple students can talk to the bot at once.

## Prerequisites

- Node.js (v18 or higher)
- NPM or Yarn
- Docker & Docker Compose (optional, for deployment)
- A Telegram Bot Token (from [@BotFather](https://t.me/BotFather))

## Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/placement-bot.git
   cd placement-bot
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Copy the example `.env` file:
   ```bash
   cp .env.example .env
   ```
   Fill in your `BOT_TOKEN` in `.env`.
   *(Optional)* If you want the bot to broadcast every single new post to a global Telegram channel, add `CHANNEL_ID=@your_channel_username` (make sure you add the bot as an admin to the channel).

4. **Initialize Database:**
   ```bash
   npx prisma migrate dev --name init
   ```

## Running the Bot

### Development Mode
You can run the bot in development mode using `ts-node`:
```bash
npm run start:dev
```
*(Make sure to add `"start:dev": "ts-node src/app.ts"` in your `package.json` scripts if not already present)*

### Production Mode (Docker)
The easiest way to deploy is using Docker:
```bash
docker-compose up -d --build
```
This will start the bot and mount the SQLite database volume for persistence.

## Authentication (Admin only)

The placement portal uses a `__Secure-better-auth.session_token` cookie to fetch short-lived JWTs.
You must set this cookie in the bot so it can authenticate API requests.

1. Log in to the placement portal via your browser.
2. Open Developer Tools -> Application -> Cookies.
3. Copy the value of `__Secure-better-auth.session_token`.
4. In Telegram, send the following command to the bot (replace `<token>` with the copied value):
   ```
   /setsession <token>
   ```

*Note: The first user to interact with the bot needs their `isAdmin` flag set to `true` in the SQLite database to use this command. You can do this via any SQLite viewer.*

## Commands

- `/start` - Register and start receiving notifications
- `/help` - Show available commands
- `/subscribe <keyword>` - Add a filter keyword (e.g., `/subscribe Amazon`)
- `/unsubscribe <keyword>` - Remove a filter keyword
- `/subscriptions` - List your active subscriptions
- `/latest` - Fetch the 5 most recent posts
- `/status` - Check bot status
- `/setsession <token>` - (Admin only) Update the authentication session cookie

## Troubleshooting

- **No notifications sent?** Check `/status`. If posts are fetched but not sent, check your `/subscriptions` or ensure your session cookie hasn't expired.
- **Authentication errors?** The `__Secure-better-auth.session_token` might have expired. Fetch a new one from your browser and update it using `/setsession`.
