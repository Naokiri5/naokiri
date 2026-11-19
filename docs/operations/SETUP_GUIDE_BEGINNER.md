# Beginner Setup Guide

You do not need to write code. These steps let you run MIA on your own computer. (In a Claude Code cloud session Claude
runs it for you, so you can skip to "First use".)

## 1. Install Node.js (one time)
1. Open **https://nodejs.org/** in your browser.
2. Click the big **LTS** download button (Node 22.16+ in the 22 LTS line, or Node 24+).
3. Run the installer and accept the defaults.
4. **Success looks like:** opening a terminal and typing `node -v` prints Node 22.16+ in the 22 LTS line or Node 24+.
   - Windows: press the Start key, type **PowerShell**, open it.
   - Mac: press ⌘ + Space, type **Terminal**, open it.

## 2. Download MIA (one time)
1. Open **https://github.com/Naokiri5/naokiri**.
2. Click the green **Code** button → **Download ZIP**.
3. Unzip it somewhere easy, such as your Documents folder.

## 3. Install and start
In the terminal, go into the unzipped folder. The simplest way is to type `cd ` (with a space), drag the folder onto the
terminal window, and press Enter. Then run this once:

```bash
npm install
```

Then start the app:

```bash
npm start
```

**Success looks like:** the terminal shows `MIA 4.1 is running` and `Local: http://localhost:8787/`. Leave this window open
while you use MIA. Closing it stops the app.

## 4. First use (in the browser)
1. Open **http://localhost:8787/**.
2. Enter the **first-time setup code** shown in the MIA terminal or service log and create your **owner passphrase**
   (10+ characters). Store the passphrase in a password manager. There is no "forgot password" yet.
3. Click **Risk Center** in the left menu → read the limits → type your passphrase in the box → **Accept policy**.
4. Click **Strategy Lab** → run a backtest → read the *out-of-sample* numbers → only if you accept them, click
   **Promote to paper**.
5. Click **Bot Account** → **Allocate** some paper money → type your passphrase → **Switch** next to *Paper*.

The orange **PAPER** badge at the top means everything is simulated. No real money is ever used.

## If something goes wrong
| You see | Do this |
|---|---|
| "Port 8787 is already in use" | MIA is already running in another window. Use that one, or close it and run `npm start` again. |
| "requires Node.js 22.16+" | Repeat step 1. |
| "Dependencies are not installed" | Run `npm install`, then `npm start`. |
| The page never loads | Make sure the terminal still shows "MIA 4.1 is running", then reload the page. |

Never paste passwords, API keys or seed phrases into a chat. MIA will never ask for a seed phrase.
